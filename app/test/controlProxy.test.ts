import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { resolveControlChannel, listenControl } from '../../service/src/controlChannel.js';
import { createControlMiddleware, createSessionStore } from '../server/controlProxy.js';

type Seen = { method?: string; url?: string; cookie?: string; body: string };

async function harness({ upstream = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-proxy-'));
  const channel = resolveControlChannel({ WAYPOINT_CONTROL_DIR: path.join(dir, 'control') });
  const seen: Seen[] = [];
  const control = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, cookie: req.headers.cookie, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
  });
  if (upstream) await listenControl(control, channel);
  const store = createSessionStore(channel.dir);
  const middleware = createControlMiddleware({ channel, store });
  const app = http.createServer((req, res) => middleware(req, res, () => { res.writeHead(200); res.end('spa'); }));
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  const close = () => Promise.all([app, control].filter((s) => s.listening).map((s) => new Promise((resolve) => s.close(resolve))));
  return { base, store, seen, close, channel };
}

async function signIn(base: string, store: ReturnType<typeof createSessionStore>) {
  const res = await fetch(`${base}/__waypoint/session?code=${store.issueBootstrapCode()}`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /^waypoint_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
  return cookie.split(';')[0];
}

test('/api without a valid session cookie is rejected before reaching the control pipe', async () => {
  const h = await harness();
  try {
    for (const headers of [{}, { cookie: 'waypoint_session=forged' }, { cookie: 'other=1' }]) {
      const res = await fetch(`${h.base}/api/hermes/skills`, { headers: { ...headers, origin: 'http://127.0.0.1:5173' } });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, 'session_required');
    }
    const put = await fetch(`${h.base}/api/hermes/skills/spike`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' });
    assert.equal(put.status, 403);
    assert.deepEqual(h.seen, []);
    assert.equal(await fetch(`${h.base}/settings`).then((r) => r.text()), 'spa');
  } finally { await h.close(); }
});

test('one-time bootstrap code mints an HttpOnly session that proxies to the control pipe', async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(`${h.base}/__waypoint/session?code=guess`, { redirect: 'manual' })).status, 403);
    const code = h.store.issueBootstrapCode();
    assert.equal((await fetch(`${h.base}/__waypoint/session?code=wrong`, { redirect: 'manual' })).status, 403);
    const first = await fetch(`${h.base}/__waypoint/session?code=${code}`, { redirect: 'manual' });
    assert.equal(first.status, 303);
    const cookie = (first.headers.get('set-cookie') || '').split(';')[0];
    assert.equal((await fetch(`${h.base}/__waypoint/session?code=${code}`, { redirect: 'manual' })).status, 403, 'code is single-use');

    const health = await fetch(`${h.base}/api/healthz`, { headers: { cookie } }).then((r) => r.json());
    assert.deepEqual(health, { ok: true, path: '/healthz' });
    const put = await fetch(`${h.base}/api/hermes/skills/spike`, { method: 'PUT', headers: { cookie: `x=1; ${cookie}`, 'content-type': 'application/json' }, body: '{"enabled":true}' });
    assert.equal(put.status, 200);
    assert.deepEqual(h.seen.map((s) => [s.method, s.url, s.cookie, s.body]), [['GET', '/healthz', undefined, ''], ['PUT', '/hermes/skills/spike', undefined, '{"enabled":true}']]);

    const again = await signIn(h.base, h.store);
    assert.notEqual(again, cookie);
    assert.equal((await fetch(`${h.base}/api/missions`, { headers: { cookie } })).status, 200, 'earlier sessions stay valid');
  } finally { await h.close(); }
});

test('expired bootstrap codes and sessions are refused', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-session-'));
  let now = 1_000_000;
  const store = createSessionStore(dir, () => now);
  const stale = store.issueBootstrapCode();
  now += 3 * 60 * 1000;
  assert.equal(store.redeem(stale), null);
  const token = store.redeem(store.issueBootstrapCode());
  assert.ok(token);
  assert.equal(store.isValid(token), true);
  now += 31 * 24 * 60 * 60 * 1000;
  assert.equal(store.isValid(token), false);
  const files = await fs.readdir(dir);
  assert.equal(JSON.stringify(await Promise.all(files.map((f) => fs.readFile(path.join(dir, f), 'utf8')))).includes(token as string), false, 'only hashes are persisted');
});

test('pairing shows only a fingerprint and signs in after host approval of that fingerprint', async () => {
  const h = await harness();
  try {
    const page = await fetch(`${h.base}/__waypoint/pair`, { redirect: 'manual' });
    assert.equal(page.status, 200);
    const pairCookie = (page.headers.get('set-cookie') || '');
    assert.match(pairCookie, /^waypoint_pairing=[\w-]{43}; Path=\/__waypoint\/pair; HttpOnly; SameSite=Strict; Max-Age=300$/);
    const secret = pairCookie.split(';')[0].split('=')[1];
    const html = await page.text();
    assert.equal(html.includes(secret), false, 'pairing secret never appears in the page');
    const fingerprint = (html.match(/id="fingerprint"[^>]*>([A-Z0-9]{4}-[A-Z0-9]{4})</) || [])[1];
    assert.ok(fingerprint);
    const status = (cookie: string) => fetch(`${h.base}/__waypoint/pair/status`, { headers: { cookie } });

    const attacker = await fetch(`${h.base}/__waypoint/pair`);
    const attackerCookie = (attacker.headers.get('set-cookie') || '').split(';')[0];
    assert.equal((await status(pairCookie.split(';')[0]).then((r) => r.json())).state, 'pending');
    assert.equal(h.store.approvePairing('ZZZZ-ZZZZ'), false);
    assert.equal(h.store.approvePairing(fingerprint.toLowerCase().replace('-', '')), true);
    assert.equal((await status(attackerCookie).then((r) => r.json())).state, 'pending', 'other pairings stay unapproved');
    assert.equal((await status('waypoint_pairing=forged')).status, 410);

    const done = await status(pairCookie.split(';')[0]);
    assert.equal((await done.json()).state, 'approved');
    const cookies = done.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('waypoint_session='))!;
    assert.match(session, /HttpOnly; SameSite=Strict/);
    assert.ok(cookies.some((c) => /^waypoint_pairing=; .*Max-Age=0/.test(c)));
    assert.equal((await status(pairCookie.split(';')[0])).status, 410, 'pairing is single-use');
    assert.equal((await fetch(`${h.base}/api/hermes/skills`, { headers: { cookie: session.split(';')[0] } })).status, 200);
    assert.equal((await fetch(`${h.base}/__waypoint/pair`, { redirect: 'manual', headers: { cookie: session.split(';')[0] } })).status, 303);
    assert.equal((await fetch(`${h.base}/__waypoint/pair`, { method: 'POST' })).status, 405);
  } finally { await h.close(); }
});

test('signed-in /api reports a clear error when the service is down', async () => {
  const h = await harness({ upstream: false });
  try {
    const cookie = await signIn(h.base, h.store);
    const res = await fetch(`${h.base}/api/healthz`, { headers: { cookie } });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, 'control_unavailable');
  } finally { await h.close(); }
});
