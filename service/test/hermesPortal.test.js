import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { HermesPortal } from '../src/hermesPortal.js';


function echoChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stdin.pipe(child.stdout);
  child.kill = () => { child.stdout.end(); child.emit('close', 0); };
  return child;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fixture({ dryRun = false, ceoRunning = true, readyAfter = 0, idleMs = 60000 } = {}) {
  const calls = [];
  const spawned = [];
  let probes = 0;
  const hermes = {
    containerName: 'waypoint-hermes-ceo',
    inspect: async () => ({ exists: true, state: { running: ceoRunning } }),
    runner: async (command, args) => {
      calls.push(args);
      if (args.includes('python3')) return { code: probes++ >= readyAfter ? 0 : 1, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  const config = { dryRun, hermes: { portalPort: await freePort(), portalIdleMs: idleMs } };
  const portal = new HermesPortal({ config, hermes, readyDelayMs: 1, spawner: (command, args) => { spawned.push(args); return echoChild(); } });
  return { portal, calls, spawned, config };
}

function roundTrip(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
    socket.once('data', (data) => { resolve(data.toString()); socket.destroy(); });
    socket.once('error', reject);
  });
}

test('opening a dashboard starts Hermes in the target container and tunnels one loopback port to it', async () => {
  const { portal, calls, spawned, config } = await fixture({ readyAfter: 2 });
  try {
    const opened = await portal.open('ceo');
    assert.deepEqual({ open: opened.open, target: opened.target, url: opened.url }, { open: true, target: 'ceo', url: `http://127.0.0.1:${config.hermes.portalPort}/` });
    const start = calls.find((args) => args.includes('-d'));
    assert.deepEqual(start, ['exec', '-d', '--user', 'hermes', 'waypoint-hermes-ceo', 'hermes', 'dashboard', '--no-open', '--skip-build', '--port', '9119', '--host', '127.0.0.1']);
    assert.equal(calls.filter((args) => args.includes('python3')).length, 3);
    assert.equal(await roundTrip(config.hermes.portalPort, 'GET / HTTP/1.1\r\n'), 'GET / HTTP/1.1\r\n');
    assert.deepEqual(spawned[0].slice(0, 5), ['exec', '-i', '--user', 'hermes', 'waypoint-hermes-ceo']);
    assert.equal(spawned[0].at(-1), '9119');
  } finally { await portal.close(); }
});

test('opening another agent closes the previous dashboard and keeps the same port', async () => {
  const { portal, calls, spawned, config } = await fixture();
  try {
    await portal.open('ceo');
    calls.length = 0;
    const second = await portal.open('builder');
    assert.equal(second.target, 'builder');
    assert.equal(second.url, `http://127.0.0.1:${config.hermes.portalPort}/`);
    assert.deepEqual(calls[0], ['exec', '--user', 'hermes', 'waypoint-hermes-ceo', 'hermes', 'dashboard', '--stop']);
    const start = calls.find((args) => args.includes('-d'));
    assert.deepEqual(start.slice(4, 8), ['waypoint-hermes-ceo', 'hermes', '-p', 'builder']);
    await roundTrip(config.hermes.portalPort, 'x');
    assert.equal(spawned.at(-1)[4], 'waypoint-hermes-ceo');
    assert.equal((await portal.open('builder')).target, 'builder');
    assert.equal(calls.filter((args) => args.includes('-d')).length, 1, 'reopening the same target reuses the dashboard');
  } finally { await portal.close(); }
  assert.deepEqual(portal.status(), { open: false, target: null, url: null, openedAt: null });
  await assert.rejects(roundTrip(portal.config.hermes.portalPort, 'x'), /ECONNREFUSED/);
});

test('portal refuses dry-run, bad targets, and a stopped CEO container', async () => {
  await assert.rejects((await fixture({ dryRun: true })).portal.open('ceo'), /dry-run/);
  const { portal } = await fixture({ ceoRunning: false });
  await assert.rejects(portal.open('Bad Seat'), /target must be/);
  await assert.rejects(portal.open('builder'), /must be running/);
});

test('an idle portal closes itself and stops the dashboard', async () => {
  const { portal, calls } = await fixture({ idleMs: 30 });
  await portal.open('ceo');
  calls.length = 0;
  for (let i = 0; i < 100 && portal.status().open; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(portal.status().open, false);
  assert.ok(calls.some((args) => args.at(-1) === '--stop'));
});
