import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { HermesPortal } from '../src/hermesPortal.js';
import { fakeHermes } from './fakeHermes.js';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fakeDashboard(readyAfter) {
  let probes = 0;
  const server = net.createServer((socket) => {
    socket.once('data', (chunk) => {
      if (!/user-agent:/i.test(String(chunk))) {
        socket.write(chunk);
        socket.pipe(socket);
        return;
      }
      const status = probes++ >= readyAfter ? '200 OK' : '503 Service Unavailable';
      socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    });
    socket.on('error', () => undefined);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, probes: () => probes };
}

async function fixture({ dryRun = false, ceoRunning = true, readyAfter = 0, idleMs = 60000 } = {}) {
  const calls = [];
  const spawned = [];
  const dashboard = await fakeDashboard(readyAfter);
  const hermes = fakeHermes({
    inspect: async () => ({ exists: true, state: { running: ceoRunning } }),
    runner: async (command, args) => {
      calls.push([command, ...args]);
      return { code: 0, stdout: '', stderr: '' };
    },
    spawner: (command, args, options) => {
      spawned.push({ command, args, options });
      return Object.assign(new EventEmitter(), { unref() {} });
    },
  });
  const config = { dryRun, hermes: { portalPort: await freePort(), portalIdleMs: idleMs } };
  const portal = new HermesPortal({ config, hermes, readyDelayMs: 1, dashboardPort: dashboard.port });
  const close = async () => { await portal.close(); await new Promise((resolve) => dashboard.server.close(resolve)); };
  return { portal, calls, spawned, config, dashboard, close };
}

function roundTrip(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
    socket.once('data', (data) => { resolve(data.toString()); socket.destroy(); });
    socket.once('error', reject);
  });
}

test('opening a dashboard starts Hermes in the background and tunnels one loopback port to it', async () => {
  const { portal, spawned, config, dashboard, close } = await fixture({ readyAfter: 2 });
  try {
    const opened = await portal.open('ceo');
    assert.deepEqual({ open: opened.open, target: opened.target, url: opened.url }, { open: true, target: 'ceo', url: `http://127.0.0.1:${config.hermes.portalPort}/` });
    assert.deepEqual([spawned[0].command, ...spawned[0].args], ['hermes', 'dashboard', '--no-open', '--skip-build', '--port', String(dashboard.port), '--host', '127.0.0.1']);
    assert.equal(spawned[0].options.detached, true);
    assert.equal(dashboard.probes(), 3);
    assert.equal(await roundTrip(config.hermes.portalPort, 'GET / HTTP/1.1\r\n'), 'GET / HTTP/1.1\r\n');
  } finally { await close(); }
});

test('opening another agent closes the previous dashboard and keeps the same port', async () => {
  const { portal, calls, spawned, config, close } = await fixture();
  try {
    await portal.open('ceo');
    calls.length = 0;
    const second = await portal.open('builder');
    assert.equal(second.target, 'builder');
    assert.equal(second.url, `http://127.0.0.1:${config.hermes.portalPort}/`);
    assert.deepEqual(calls[0], ['hermes', 'dashboard', '--stop']);
    assert.deepEqual(spawned.at(-1).args.slice(0, 3), ['-p', 'builder', 'dashboard']);
    assert.equal(await roundTrip(config.hermes.portalPort, 'x'), 'x');
    assert.equal((await portal.open('builder')).target, 'builder');
    assert.equal(spawned.length, 2, 'reopening the same target reuses the dashboard');
  } finally { await close(); }
  assert.deepEqual(portal.status(), { open: false, target: null, url: null, openedAt: null });
  await assert.rejects(roundTrip(portal.config.hermes.portalPort, 'x'), /ECONNREFUSED/);
});

test('portal refuses dry-run, bad targets, and a stopped CEO', async () => {
  const dry = await fixture({ dryRun: true });
  await assert.rejects(dry.portal.open('ceo'), /dry-run/);
  await dry.close();
  const { portal, close } = await fixture({ ceoRunning: false });
  await assert.rejects(portal.open('Bad Seat'), /target must be/);
  await assert.rejects(portal.open('builder'), /must be running/);
  await close();
});

test('an idle portal closes itself and stops the dashboard', async () => {
  const { portal, calls, close } = await fixture({ idleMs: 30 });
  await portal.open('ceo');
  calls.length = 0;
  for (let i = 0; i < 100 && portal.status().open; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(portal.status().open, false);
  assert.ok(calls.some((args) => args.at(-1) === '--stop'));
  await close();
});
