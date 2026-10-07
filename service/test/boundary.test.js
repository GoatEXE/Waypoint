import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { listenControl, resolveControlChannel } from '../src/controlChannel.js';

async function start() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-boundary-'));
  const app = await createApp({ PORT: '3081', HOST: '127.0.0.1', DATA_DIR: dataDir, WAYPOINT_CONTROL_DIR: path.join(dataDir, 'control'), LOG_LEVEL: 'error', HERMES_AUTO_START: 'false' });
  await new Promise((resolve) => app.bridgeServer.listen(0, '127.0.0.1', resolve));
  await listenControl(app.server, app.config.control);
  return { ...app, bridgePort: app.bridgeServer.address().port };
}
async function stop(app) {
  await Promise.all([app.server, app.bridgeServer].map((s) => new Promise((resolve) => s.close(resolve))));
}
function send(target, { method = 'GET', path: urlPath, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...target, method, path: urlPath, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const json = { 'content-type': 'application/json' };

test('bridge TCP listener serves only POST /bridge/tools, even with a spoofed local Host', async () => {
  const app = await start();
  app.hermes.skills = async () => { throw new Error('control route must not run on the bridge port'); };
  app.hermes.setSkillEnabled = app.hermes.skills;
  app.hermes.saveApiKey = app.hermes.skills;
  try {
    const tcp = { host: '127.0.0.1', port: app.bridgePort };
    const spoof = { host: `127.0.0.1:${app.bridgePort}`, origin: `http://127.0.0.1:${app.bridgePort}` };
    const probes = [
      { path: '/healthz' },
      { path: '/config' },
      { path: '/hermes/skills' },
      { path: '/hermes/status' },
      { path: '/missions' },
      { path: '/bridge/tools' },
      { method: 'PUT', path: '/hermes/skills/spike', body: '{"enabled":true}' },
      { method: 'PUT', path: '/hermes/skills/spike', body: 'x' },
      { method: 'PUT', path: '/hermes/providers/anthropic/api-key', body: '{"apiKey":"x"}' },
      { method: 'PUT', path: '/hermes/model', body: '{}' },
      { method: 'POST', path: '/hermes/lifecycle', body: '{"action":"stop"}' },
      { method: 'POST', path: '/missions', body: '{"title":"x"}' },
    ];
    for (const probe of probes) {
      const res = await send(tcp, { ...probe, headers: { ...json, ...spoof } });
      assert.equal(res.status, 404, `${probe.method || 'GET'} ${probe.path}`);
      assert.equal(res.body.error.code, 'not_found');
    }
    const health = JSON.stringify({ tool: 'health', args: {} });
    assert.equal((await send(tcp, { method: 'POST', path: '/bridge/tools', headers: { ...json, ...spoof }, body: health })).status, 403);
    assert.equal((await send(tcp, { method: 'POST', path: '/bridge/tools', headers: { ...json, authorization: `Bearer ${app.config.bridge.token}x` }, body: health })).status, 403);
    assert.equal((await send(tcp, { method: 'POST', path: '/bridge/tools', headers: { ...json, authorization: app.config.bridge.token }, body: health })).status, 403);
    const ok = await send(tcp, { method: 'POST', path: '/bridge/tools', headers: { ...json, authorization: `Bearer ${app.config.bridge.token}` }, body: health });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
  } finally { await stop(app); }
});

test('control API is served on the host-only pipe/socket, not the bridge port', async () => {
  const app = await start();
  app.hermes.setSkillEnabled = async (name, body) => ({ available: true, skill: { name, enabled: body.enabled } });
  try {
    const pipe = { socketPath: app.config.control.socketPath };
    const health = await send(pipe, { path: '/healthz' });
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    const config = await send(pipe, { path: '/config' });
    assert.equal(config.body.control.transport, process.platform === 'win32' ? 'named-pipe' : 'unix-socket');
    const toggled = await send(pipe, { method: 'PUT', path: '/hermes/skills/spike', headers: json, body: '{"enabled":true}' });
    assert.equal(toggled.status, 200);
    assert.equal(toggled.body.skill.enabled, true);
    assert.equal((await send(pipe, { method: 'POST', path: '/bridge/tools', headers: { ...json, authorization: `Bearer ${app.config.bridge.token}` }, body: '{"tool":"health"}' })).status, 404);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(app.config.control.dir)).mode & 0o777, 0o700);
      assert.equal((await fs.stat(app.config.control.socketPath)).mode & 0o777, 0o600);
    }
  } finally { await stop(app); }
});

test('control channel resolves a host-only pipe or socket path', () => {
  const win = resolveControlChannel({ WAYPOINT_CONTROL_DIR: 'C:\\waypoint\\control' }, 'win32');
  assert.equal(win.transport, 'named-pipe');
  assert.match(win.socketPath, /^\\\\\.\\pipe\\waypoint-control-[0-9a-f]{16}$/);
  assert.equal(resolveControlChannel({ WAYPOINT_CONTROL_DIR: 'C:\\waypoint\\control' }, 'win32').socketPath, win.socketPath);
  assert.notEqual(resolveControlChannel({ WAYPOINT_CONTROL_DIR: 'C:\\other\\control' }, 'win32').socketPath, win.socketPath);
  const unix = resolveControlChannel({ WAYPOINT_CONTROL_DIR: '/tmp/wp' }, 'linux');
  assert.equal(unix.transport, 'unix-socket');
  assert.equal(unix.socketPath, path.join(path.resolve('/tmp/wp'), 'control.sock'));
  assert.throws(() => resolveControlChannel({ WAYPOINT_CONTROL_DIR: `/tmp/${'x'.repeat(120)}` }, 'linux'), /too long/);
});
