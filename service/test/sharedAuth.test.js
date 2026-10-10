import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { assertSharedAuthImage, ensureSharedAuthVolume, verifySharedAuthVolume } from '../src/authVolume.js';

const image = `sha256:${'a'.repeat(64)}`;
const config = () => loadConfig({ WAYPOINT_BRIDGE_TOKEN: 'a'.repeat(32), WAYPOINT_SHARED_AUTH: 'true', HERMES_DOCKER_IMAGE: image }, '/tmp');

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
