import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { DockerAdapter } from '../src/docker.js';
import { PodSeats } from '../src/podSeats.js';
import { assertSharedAuthImage, ensureSharedAuthVolume, verifySharedAuthVolume } from '../src/authVolume.js';

const podId = 'pod_11111111-2222-4333-8444-555555555555';
const image = `sha256:${'a'.repeat(64)}`;
const config = () => loadConfig({ WAYPOINT_BRIDGE_TOKEN: 'a'.repeat(32), WAYPOINT_SHARED_AUTH: 'true', POD_DOCKER_IMAGE: image, HERMES_DOCKER_IMAGE: image }, '/tmp');

test('shared auth plan pins a second named volume without exposing CEO home or a host path', () => {
  const cfg = config();
  const plan = new DockerAdapter(cfg).startPlan({ podId, podName: 'fixture' });
  const mounts = plan.args.filter((value, index) => plan.args[index - 1] === '--mount');
  assert.equal(mounts.length, 2);
  assert.ok(mounts[0].includes('target=/opt/data'));
  assert.equal(mounts[1], `type=volume,source=${cfg.sharedAuth.volumeName},target=/opt/waypoint-auth,volume-nocopy`);
  assert.equal(plan.security.sharedProviderAuth, true);
  assert.equal(plan.imagePinned, true);
  assert.equal(plan.args.join(' ').includes(cfg.hermes.volumeName), false);
});

test('shared auth volume refuses unowned, bind-backed, and wrong-image resources', async () => {
  const cfg = config();
  const calls = [];
  const runner = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'image') return { code: 0, stdout: 'true\n' };
    if (args[0] === 'volume') return { code: 0, stdout: JSON.stringify({ name: cfg.sharedAuth.volumeName, owned: 'true', driver: 'local', options: null }) };
    throw new Error('unexpected command');
  };
  await assertSharedAuthImage(cfg, runner, image);
  await verifySharedAuthVolume(cfg, runner);
  await ensureSharedAuthVolume(cfg, runner);
  assert.equal(calls.some((args) => args[0] === 'run'), false);
  await assert.rejects(verifySharedAuthVolume(cfg, async () => ({ code: 0, stdout: JSON.stringify({ name: cfg.sharedAuth.volumeName, owned: 'false', driver: 'local', options: null }) })), /unowned/);
  await assert.rejects(verifySharedAuthVolume(cfg, async () => ({ code: 0, stdout: JSON.stringify({ name: cfg.sharedAuth.volumeName, owned: 'true', driver: 'local', options: { type: 'none', device: '/host' } }) })), /unsafe/);
  await assert.rejects(assertSharedAuthImage(cfg, async () => ({ code: 0, stdout: 'false\n' }), image), /image overlay/);
});

test('seat readiness accepts only the two expected volumes in shared auth mode', async () => {
  const cfg = config();
  const docker = new DockerAdapter(cfg);
  const volumeName = docker.makeVolumeName(podId);
  const shared = { Type: 'volume', Name: cfg.sharedAuth.volumeName, Destination: cfg.sharedAuth.mountPath, RW: true };
  const own = { Type: 'volume', Name: volumeName, Destination: '/opt/data', RW: true };
  const container = { owned: 'true', podId, running: true, image, mounts: [own, shared], privileged: false, portBindings: {}, capAdd: null, networkMode: 'bridge', networks: { bridge: {} } };
  const calls = [];
  const runner = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'inspect') return { code: 0, stdout: JSON.stringify(container) };
    if (args[0] === 'volume' && args.at(-1) === volumeName) return { code: 0, stdout: JSON.stringify({ owned: 'true', podId, name: volumeName, driver: 'local', options: {} }) };
    if (args[0] === 'volume') return { code: 0, stdout: JSON.stringify({ owned: 'true', name: cfg.sharedAuth.volumeName, driver: 'local', options: {} }) };
    throw new Error('unexpected command');
  };
  const seats = new PodSeats({ config: cfg, docker, runner });
  await seats.verifyPod({ podId, containerName: docker.makeContainerName(podId), volumeName });
  assert.equal(calls.length, 3);
  container.mounts = [own];
  await assert.rejects(seats.verifyPod({ podId, containerName: docker.makeContainerName(podId), volumeName }), /unexpected mounts/);
});
