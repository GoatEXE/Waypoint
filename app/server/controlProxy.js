import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ensureControlDir, resolveControlChannel } from '../../service/src/controlChannel.js';

// Dev/preview-server gate in front of the host-only control pipe. The Vite port is reachable
// from Docker Desktop containers, so every /api request needs an HttpOnly session cookie that
// only a host process (`npm run open`) can mint via a one-time bootstrap code.
export const SESSION_COOKIE = 'waypoint_session';
export const BOOTSTRAP_PATH = '/__waypoint/session';
export const PAIR_PATH = '/__waypoint/pair';
const PAIR_COOKIE = 'waypoint_pairing';
const PAIR_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRINGS = 10;
const FINGERPRINT_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BOOTSTRAP_TTL_MS = 2 * 60 * 1000;
const MAX_SESSIONS = 20;
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-connection', 'upgrade', 'te', 'trailer'];

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
// Public, non-secret pairing label (~40 bits) derived from the browser-held pairing secret.
function fingerprintOf(secret) {
  const bytes = createHash('sha256').update(`fingerprint:${secret}`).digest();
  const chars = Array.from(bytes.subarray(0, 8), (b) => FINGERPRINT_ALPHABET[b % FINGERPRINT_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
export const normalizeFingerprint = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback; throw error; }
}
function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function createSessionStore(dir, now = Date.now) {
  const sessionsFile = path.join(dir, 'app-sessions.json');
  const bootstrapFile = path.join(dir, 'app-bootstrap.json');
  const pairingsFile = path.join(dir, 'app-pairings.json');
  const liveSessions = () => (readJson(sessionsFile, { sessions: [] }).sessions || []).filter((s) => s.expiresAt > now());
  const livePairings = () => (readJson(pairingsFile, { pairings: [] }).pairings || []).filter((p) => p.expiresAt > now());
  const mintSession = () => {
    const token = randomBytes(32).toString('base64url');
    writeJson(sessionsFile, { sessions: [...liveSessions(), { hash: sha256(token), expiresAt: now() + SESSION_TTL_MS }].slice(-MAX_SESSIONS) });
    return token;
  };
  return {
    issueBootstrapCode() {
      ensureControlDir(dir);
      const code = randomBytes(32).toString('base64url');
      writeJson(bootstrapFile, { hash: sha256(code), expiresAt: now() + BOOTSTRAP_TTL_MS });
      return code;
    },
    // Returns a new session token, or null. A code is single-use and short-lived.
    redeem(code) {
      if (typeof code !== 'string' || !code) return null;
      const pending = readJson(bootstrapFile, null);
      if (!pending?.hash || !(pending.expiresAt > now())) return null;
      const expected = Buffer.from(String(pending.hash));
      const actual = Buffer.from(sha256(code));
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      fs.rmSync(bootstrapFile, { force: true });
      return mintSession();
    },
    // Pairing: the browser keeps a secret in an HttpOnly cookie and displays only its fingerprint;
    // a host process approves that fingerprint (`npm run approve -- XXXX-XXXX`). No secret is ever shown.
    startPairing() {
      ensureControlDir(dir);
      const secret = randomBytes(32).toString('base64url');
      const fingerprint = fingerprintOf(secret);
      const pairings = [...livePairings(), { hash: sha256(secret), fingerprint, approved: false, expiresAt: now() + PAIR_TTL_MS }].slice(-MAX_PAIRINGS);
      writeJson(pairingsFile, { pairings });
      return { secret, fingerprint };
    },
    approvePairing(fingerprint) {
      const wanted = normalizeFingerprint(fingerprint);
      const pairings = livePairings();
      const matches = pairings.filter((p) => p.fingerprint === wanted);
      if (matches.length !== 1) return false;
      matches[0].approved = true;
      writeJson(pairingsFile, { pairings });
      return true;
    },
    // Returns { state: 'approved', token } | { state: 'pending' } | { state: 'expired' }.
    completePairing(secret) {
      if (!secret) return { state: 'expired' };
      const hash = sha256(secret);
      const pairings = livePairings();
      const pairing = pairings.find((p) => p.hash === hash);
      if (!pairing) return { state: 'expired' };
      if (!pairing.approved) return { state: 'pending' };
      writeJson(pairingsFile, { pairings: pairings.filter((p) => p !== pairing) });
      return { state: 'approved', token: mintSession() };
    },
    isValid(token) {
      if (!token) return false;
      const hash = sha256(token);
      return liveSessions().some((s) => s.hash === hash);
    },
  };
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const sessionCookie = (token) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;

function handleBootstrap(req, res, store) {
  const code = new URL(req.url, 'http://waypoint.local').searchParams.get('code');
  const token = req.method === 'GET' ? store.redeem(code) : null;
  if (!token) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('This Waypoint sign-in link is invalid, expired, or already used. Run `npm run open` in app/ on this computer to get a new one, or open /__waypoint/pair in this browser.\n');
    return;
  }
  res.writeHead(303, { location: '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'set-cookie': sessionCookie(token) });
  res.end();
}

function handlePairStatus(req, res, store) {
  const result = store.completePairing(readCookie(req.headers.cookie, PAIR_COOKIE));
  if (result.state !== 'approved') return sendJson(res, result.state === 'pending' ? 200 : 410, { state: result.state });
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'set-cookie': [sessionCookie(result.token), `${PAIR_COOKIE}=; Path=${PAIR_PATH}; HttpOnly; SameSite=Strict; Max-Age=0`],
  });
  res.end(JSON.stringify({ state: 'approved' }));
}

function handlePairStart(req, res, store) {
  if (store.isValid(readCookie(req.headers.cookie, SESSION_COOKIE))) {
    res.writeHead(303, { location: '/', 'cache-control': 'no-store' });
    return res.end();
  }
  const { secret, fingerprint } = store.startPairing();
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'set-cookie': `${PAIR_COOKIE}=${secret}; Path=${PAIR_PATH}; HttpOnly; SameSite=Strict; Max-Age=${PAIR_TTL_MS / 1000}`,
  });
  res.end(`<!doctype html><meta charset="utf-8"><title>Pair Waypoint</title>
<body style="font:16px system-ui;max-width:36rem;margin:4rem auto;line-height:1.5">
<h1>Pair this browser with Waypoint</h1>
<p>Pairing fingerprint (not a secret): <strong id="fingerprint" style="font:600 1.5rem ui-monospace,monospace">${fingerprint}</strong></p>
<p>On this computer, in <code>app/</code>, run <code>npm run approve -- ${fingerprint}</code></p>
<p id="state">Waiting for approval (expires in 5 minutes)…</p>
<script>
const tick = async () => {
  const r = await fetch('${PAIR_PATH}/status', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ state: 'pending' }));
  if (r.state === 'approved') return location.replace('/');
  if (r.state === 'expired') return void (document.getElementById('state').textContent = 'This pairing expired. Reload to start again.');
  setTimeout(tick, 1500);
};
tick();
</script></body>`);
}

function proxyToControl(req, res, socketPath, upstreamPath) {
  const headers = { ...req.headers };
  delete headers.cookie;
  for (const name of HOP_HEADERS) delete headers[name];
  const upstream = http.request({ socketPath, method: req.method, path: upstreamPath, headers }, (up) => {
    const responseHeaders = { ...up.headers };
    for (const name of HOP_HEADERS) delete responseHeaders[name];
    res.writeHead(up.statusCode || 502, responseHeaders);
    up.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) sendJson(res, 502, { error: { code: 'control_unavailable', message: 'Waypoint service is not reachable on its host control channel. Is `npm start` running in service/?' } });
    else res.destroy();
  });
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
}

export function createControlMiddleware({ env = process.env, channel = resolveControlChannel(env), store = createSessionStore(channel.dir) } = {}) {
  return function waypointControl(req, res, next) {
    const url = req.url || '/';
    const pathname = url.split('?')[0];
    if (pathname === BOOTSTRAP_PATH) return handleBootstrap(req, res, store);
    if (pathname === PAIR_PATH || pathname === `${PAIR_PATH}/status`) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'GET only' } });
      return pathname === PAIR_PATH ? handlePairStart(req, res, store) : handlePairStatus(req, res, store);
    }
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return next();
    if (!store.isValid(readCookie(req.headers.cookie, SESSION_COOKIE))) {
      return sendJson(res, 403, { error: { code: 'session_required', message: 'This browser is not signed in to Waypoint. Open /__waypoint/pair in this browser and approve its fingerprint with `npm run approve -- <fingerprint>` in app/, or run `npm run open` to open a signed-in window.' } });
    }
    const rest = url.slice('/api'.length);
    proxyToControl(req, res, channel.socketPath, rest.startsWith('/') ? rest : `/${rest}`);
  };
}

export function waypointControlPlugin(options) {
  const middleware = createControlMiddleware(options);
  return {
    name: 'waypoint-control',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
