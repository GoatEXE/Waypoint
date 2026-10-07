import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PodStore } from '../src/store.js';
import { resolveSeatModel } from '../src/podSeats.js';

// Seat model persistence only: no pods are started, no model is called, and no auth is read.
async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-seat-model-')); }
function planFactory({ podId }) { return { command: 'docker', args: [], labels: {}, volumeName: `vol-${podId}`, containerName: `ctr-${podId}` }; }

async function setup() {
  const dataDir = await tmp();
  const store = new PodStore(dataDir);
  const template = await store.createTemplate({ name: 'models', version: '1', seats: [{ id: 'coder', role: 'implementation' }, { id: 'reviewer', role: 'review' }] });
  const pod = await store.cloneTemplate(template.id, { podName: 'model-pod' }, planFactory);
  return { dataDir, store, template, pod };
}
const manifestPath = (dataDir, podId) => path.join(dataDir, 'instances', podId, 'manifest.json');
const readManifest = async (dataDir, podId) => JSON.parse(await fs.readFile(manifestPath(dataDir, podId), 'utf8'));
const model = { provider: 'anthropic', default: 'claude-sonnet-5' };

test('setSeatModel persists only the normalized model on the seat and returns a path-free summary', async () => {
  const { dataDir, store, pod } = await setup();
  const before = await readManifest(dataDir, pod.id);
  const result = await store.setSeatModel(pod.id, 'coder', { provider: 'openai', default: 'gpt-5', api_mode: 'responses', base_url: 'https://api.example.com/v1' });
  assert.deepEqual(result, {
    podId: pod.id,
    podName: 'model-pod',
    seat: { id: 'coder', role: 'implementation', model: { provider: 'openai-api', default: 'gpt-5', api_mode: 'responses', base_url: 'https://api.example.com/v1' } },
  });
  assert.ok(!JSON.stringify(result).includes(dataDir));

  const after = await readManifest(dataDir, pod.id);
  const { seats: seatsBefore, ...restBefore } = before;
  const { seats: seatsAfter, ...restAfter } = after;
  assert.deepEqual(restAfter, restBefore);
  assert.deepEqual(seatsAfter[0], { ...seatsBefore[0], model: result.seat.model });
  assert.deepEqual(seatsAfter[1], seatsBefore[1]);
});

test('seat model survives reload and is what podSeats resolves for the seat', async () => {
  const { dataDir, store, template, pod } = await setup();
  await store.setSeatModel(pod.id, 'reviewer', model);
  const reloaded = await new PodStore(dataDir).getInstance(pod.id);
  const reviewer = reloaded.seats.find((seat) => seat.id === 'reviewer');
  assert.deepEqual(reviewer.model, { provider: 'anthropic', default: 'claude-sonnet-5', api_mode: '', base_url: '' });
  assert.deepEqual(resolveSeatModel({ instance: reloaded, template, seat: reviewer }), { source: 'seat', value: reviewer.model });
  assert.equal(reloaded.seats.find((seat) => seat.id === 'coder').model, undefined);
});

test('a null model clears the seat override', async () => {
  const { dataDir, store, pod } = await setup();
  await store.setSeatModel(pod.id, 'coder', model);
  const cleared = await store.setSeatModel(pod.id, 'coder', null);
  assert.equal(cleared.seat.model, null);
  const seat = (await readManifest(dataDir, pod.id)).seats.find((item) => item.id === 'coder');
  assert.equal('model' in seat, false);
  assert.deepEqual(Object.keys(seat).sort(), ['copiedFiles', 'id', 'instructions', 'profileDir', 'role', 'state']);
});

test('invalid and secret-like model fields are rejected without writing', async () => {
  const { dataDir, store, pod } = await setup();
  const before = await fs.readFile(manifestPath(dataDir, pod.id), 'utf8');
  for (const bad of [
    'anthropic',
    [],
    { provider: 'anthropic' },
    { provider: 'nope', default: 'x' },
    { provider: 'anthropic', default: 'bad model name' },
    { ...model, api_key: 'sk-abcdefghijklmnop' },
    { ...model, token: 'x' },
    { ...model, authToken: 'x' },
    { ...model, temperature: 1 },
    { ...model, api_mode: 'Bad Mode' },
    { ...model, base_url: 'ftp://example.com' },
    { ...model, base_url: 'https://user:pass@example.com' },
    { ...model, base_url: 'https://example.com/?key=abc' },
  ]) {
    await assert.rejects(store.setSeatModel(pod.id, 'coder', bad), (error) => error.status === 400, JSON.stringify(bad));
  }
  assert.equal(await fs.readFile(manifestPath(dataDir, pod.id), 'utf8'), before);
});

test('unknown pods and seats are rejected', async () => {
  const { store, pod } = await setup();
  await assert.rejects(store.setSeatModel('pod_00000000-0000-4000-8000-000000000000', 'coder', model), (error) => error.status === 404);
  await assert.rejects(store.setSeatModel('../pod', 'coder', model), (error) => error.status === 400);
  await assert.rejects(store.setSeatModel(pod.id, 'ghost', model), (error) => error.status === 404 && error.details.seatId === 'ghost');
  for (const seatId of ['../coder', 'Coder', '', undefined]) {
    await assert.rejects(store.setSeatModel(pod.id, seatId, model), (error) => error.status === 400);
  }
});

test('concurrent seat model and lifecycle updates do not lose writes', async () => {
  const { dataDir, store, pod } = await setup();
  await Promise.all([
    store.setSeatModel(pod.id, 'coder', model),
    store.recordLifecycle(pod.id, { action: 'status', dryRun: false, executed: true, status: { running: true, state: 'running' } }, planFactory),
    store.setSeatModel(pod.id, 'reviewer', { provider: 'openai-codex', default: 'gpt-5-codex' }),
  ]);
  const manifest = await readManifest(dataDir, pod.id);
  assert.equal(manifest.state, 'running');
  assert.equal(manifest.seats.find((seat) => seat.id === 'coder').model.provider, 'anthropic');
  assert.equal(manifest.seats.find((seat) => seat.id === 'reviewer').model.provider, 'openai-codex');
});
