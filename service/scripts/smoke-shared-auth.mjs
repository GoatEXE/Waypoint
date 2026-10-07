import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { PodStore } from '../src/store.js';
import { DockerAdapter } from '../src/docker.js';
import { PodSeats } from '../src/podSeats.js';

const suffix = randomBytes(4).toString('hex');
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-shared-auth-smoke-'));
const config = loadConfig({
  ...process.env,
  DATA_DIR: dataDir,
  DRY_RUN: 'false',
  HERMES_AUTO_START: 'false',
  POD_NAME_PREFIX: `wpsmoke${suffix}`,
  POD_VOLUME_PREFIX: `wpsmokedata${suffix}`,
}, process.cwd());
if (!config.sharedAuth.enabled) throw new Error('shared auth is disabled');
const store = new PodStore(config.dataDir);
const docker = new DockerAdapter(config);
const seats = new PodSeats({ config, docker });
let pod;
let containerName;
let volumeName;
try {
  await store.ensure();
  const template = await store.createTemplate({ name: `shared auth smoke ${suffix}`, version: '1', seats: [{ id: 'builder', role: 'Builder' }], baselineFiles: { 'SOUL.md': 'Run only the assigned test task.' }, config: { model: { provider: 'openai-codex', default: 'gpt-6-luna' } } });
  pod = await store.cloneTemplate(template.id, { podName: `shared-auth-smoke-${suffix}` }, ({ podId, podName }) => docker.startPlan({ podId, podName }));
  containerName = docker.makeContainerName(pod.id);
  volumeName = docker.makeVolumeName(pod.id);
  const start = await docker.lifecycle(pod, 'start');
  if (!start.status?.running) throw new Error('fixture pod did not start');
  const result = await seats.provision(pod, { template });
  const builder = result.seats.find((seat) => seat.seatId === 'builder');
  console.log(JSON.stringify({ ready: builder?.ready, auth: builder?.auth?.providers?.['openai-codex']?.state, model: builder?.model?.state, dataVolume: volumeName, sharedAuthVolume: config.sharedAuth.volumeName }));
  if (!builder?.ready) process.exitCode = 1;
} finally {
  if (containerName) {
    const remove = spawnSync('docker', ['rm', '-f', '-v', containerName], { encoding: 'utf8', windowsHide: true });
    if (remove.status !== 0 && !/No such container/i.test(remove.stderr || '')) throw new Error('fixture container cleanup failed');
  }
  if (volumeName) {
    const remove = spawnSync('docker', ['volume', 'rm', volumeName], { encoding: 'utf8', windowsHide: true });
    if (remove.status !== 0 && !/No such volume/i.test(remove.stderr || '')) throw new Error('fixture data volume cleanup failed');
  }
  const resolved = path.resolve(dataDir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('waypoint-shared-auth-smoke-')) throw new Error('fixture data path is outside expected temp root');
  await fs.rm(resolved, { recursive: true, force: true });
}
