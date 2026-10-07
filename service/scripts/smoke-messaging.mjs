
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from '../src/index.js';
import { seatAddress } from '../src/messaging.js';

function command(name, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(name, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (part) => { stdout = (stdout + part).slice(-32768); });
    child.stderr.on('data', (part) => { stderr = (stderr + part).slice(-32768); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${name} exited ${code}: ${stderr.slice(0, 300)}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-msg-smoke-'));
let app;
let container;
let volume;
let listener = false;
try {
  app = await createApp({ DATA_DIR: root, DRY_RUN: 'false', HERMES_AUTO_START: 'false', LOG_LEVEL: 'error' });
  await new Promise((resolve, reject) => { app.bridgeServer.once('error', reject); app.bridgeServer.listen(0, '127.0.0.1', resolve); });
  listener = true;
  app.config.bridge.baseUrl = `http://host.docker.internal:${app.bridgeServer.address().port}/bridge/tools`;
  const template = await app.store.createTemplate({ name: 'messaging smoke', version: '1', seats: [{ id: 'alpha', role: 'Builder' }, { id: 'beta', role: 'Reviewer' }], baselineFiles: { 'SOUL.md': 'Disposable messaging check.' }, config: {} });
  const pod = await app.store.cloneTemplate(template.id, { podName: `msg-smoke-${Math.random().toString(16).slice(2, 8)}` }, ({ podId, podName }) => app.docker.startPlan({ podId, podName }));
  container = app.docker.makeContainerName(pod.id);
  volume = app.docker.makeVolumeName(pod.id);
  await app.docker.lifecycle(pod, 'start');
  await app.podSeats.provision(pod, { template, checkAuth: false });
  await app.messaging.installSeatTools(pod, ['alpha', 'beta'], app.podSeats);

  const alpha = seatAddress(pod.id, 'alpha');
  const beta = seatAddress(pod.id, 'beta');
  const client = (seat, ...args) => ['exec', '-i', '--user', 'hermes', container, 'python3', `/opt/data/profiles/${seat}/bin/waypoint-message.py`, ...args];
  const chart = JSON.parse(await command('docker', client('alpha', 'org', 'Reviewer')));
  if (chart.pods[0]?.seats[0]?.address !== beta) throw new Error('pod org lookup failed');
  const sent = await app.messaging.send('ceo', { to: alpha, text: 'CEO to alpha live check' });
  const alphaInbox = JSON.parse(await command('docker', client('alpha', 'inbox')));
  if (alphaInbox.messages[0]?.id !== sent.id) throw new Error('CEO-to-pod delivery failed');
  await command('docker', client('alpha', 'ack', sent.id));
  const alphaAfterAck = JSON.parse(await command('docker', client('alpha', 'inbox')));
  if (alphaAfterAck.messages.length) throw new Error('message acknowledgement failed');
  const podMessage = JSON.parse(await command('docker', client('alpha', 'send', beta), 'Alpha to beta live check'));
  const betaInbox = JSON.parse(await command('docker', client('beta', 'inbox')));
  if (betaInbox.messages[0]?.id !== podMessage.id) throw new Error('pod-to-pod delivery failed');
  await command('docker', client('beta', 'send', 'ceo'), 'Beta to CEO live check');
  const ceoInbox = await app.messaging.inbox('ceo');
  if (ceoInbox.messages[0]?.from !== beta) throw new Error('pod-to-CEO delivery failed');
  console.log(JSON.stringify({ ok: true, orgLookup: true, ceoToPod: true, podToPod: true, podToCeo: true, acknowledgment: true, modelCalls: 0 }));
} finally {
  if (listener) await new Promise((resolve) => app.bridgeServer.close(resolve));
  if (container) await command('docker', ['rm', '-f', container]).catch(() => {});
  if (volume) await command('docker', ['volume', 'rm', volume]).catch(() => {});
  const resolved = path.resolve(root);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('waypoint-msg-smoke-')) throw new Error('refusing to remove unexpected temporary path');
  await fs.rm(resolved, { recursive: true, force: true });
  if (container && await command('docker', ['inspect', container]).then(() => true, () => false)) throw new Error('fixture container remained after cleanup');
  if (volume && await command('docker', ['volume', 'inspect', volume]).then(() => true, () => false)) throw new Error('fixture volume remained after cleanup');
  if (await fs.stat(resolved).then(() => true, () => false)) throw new Error('fixture data directory remained after cleanup');
}
