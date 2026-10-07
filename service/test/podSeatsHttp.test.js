import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { PINNED_HERMES_IMAGE } from '../src/config.js';

const SECRET = 'sk-test-SHOULD-NEVER-LEAK-0123456789';
const MODEL = { provider: 'anthropic', default: 'claude-sonnet-5' };
const json = { 'content-type': 'application/json' };

async function start(env = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-seats-http-'));
  const app = await createApp({ PORT: '3081', HOST: '127.0.0.1', DATA_DIR: dataDir, WAYPOINT_CONTROL_DIR: path.join(dataDir, 'control'), LOG_LEVEL: 'error', HERMES_AUTO_START: 'false', ...env });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const calls = [];
  // Any Docker call outside a test's explicit mock fails loudly.
  app.docker.runner = async (command, args) => { calls.push(['docker-adapter', ...args]); throw new Error('unexpected DockerAdapter call'); };
  app.podSeats.runner = async (command, args) => { calls.push(args); throw new Error('unexpected PodSeats call'); };
  return { ...app, calls, base: `http://127.0.0.1:${app.server.address().port}` };
}
async function stop(app) {
  await new Promise((resolve) => app.server.close(resolve));
}
async function request(app, method, urlPath, body) {
  const response = await fetch(`${app.base}${urlPath}`, { method, headers: body === undefined ? {} : json, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, text: await response.text() };
}
async function createPod(app, model = MODEL) {
  const template = await request(app, 'POST', '/pod-templates', { name: 'web squad', version: '1', seats: [{ id: 'lead', role: 'Lead' }, { id: 'coder', role: 'Coder' }], baselineFiles: { 'SOUL.md': 'seat' }, config: model ? { model } : {} });
  assert.equal(template.status, 201, template.text);
  const pod = await request(app, 'POST', `/pod-templates/${JSON.parse(template.text).id}/clone`, { podName: `squad-${Math.random().toString(16).slice(2, 8)}` });
  assert.equal(pod.status, 201, pod.text);
  return JSON.parse(pod.text);
}
/** Live-mode Docker CLI mock for an owned, running pod whose seat profiles are ready and authenticated. */
function liveRunner(app, pod, { missing = false } = {}) {
  const volumeName = app.docker.makeVolumeName(pod.id);
  return async (command, args, options = {}) => {
    app.calls.push(args);
    if (args[0] === 'inspect') {
      if (missing) return { code: 1, stdout: '', stderr: 'Error: No such object' };
      return { code: 0, stdout: JSON.stringify({ owned: 'true', podId: pod.id, running: true, image: PINNED_HERMES_IMAGE, mounts: [{ Type: 'volume', Name: volumeName, Destination: '/opt/data', RW: true }], privileged: false, portBindings: {}, capAdd: null, networkMode: 'bridge', networks: { bridge: {} } }), stderr: '' };
    }
    if (args[0] === 'volume') return { code: 0, stdout: JSON.stringify({ owned: 'true', podId: pod.id, name: volumeName, driver: 'local', options: {} }), stderr: '' };
    if (args.includes('python3')) {
      const payload = JSON.parse(options.input);
      if (payload.seatId) {
        assert.equal(payload.seatId, 'lead');
        assert.match(payload.token, /^wps1\./);
        return { code: 0, stdout: '{"installed": true}', stderr: '' };
      }
      const seats = payload.seats.map((seat) => ({ seatId: seat.id, state: 'ready', identity: true, writable: true, envPresent: true, envPrivate: true, missingSubdirs: [], foreignOwned: 0, symlinks: 2, changed: payload.mode === 'provision' ? ['.env'] : [], seatAuthFile: false, apiKey: SECRET, model: { ...MODEL, api_mode: '', baseUrlSet: false } }));
      return { code: 0, stdout: JSON.stringify({ rootOk: true, podRootAuthFile: true, seats }), stderr: '' };
    }
    if (args.includes('auth')) return { code: 0, stdout: `${args.at(-1)}: logged in\n  access_token: ${SECRET}\n`, stderr: '' };
    throw new Error(`unexpected docker call ${args.join(' ')}`);
  };
}
function assertNoLeaks(app, text) {
  for (const needle of [SECRET, app.config.dataDir, app.config.dataDir.replaceAll('\\', '\\\\'), 'instanceDir', 'profilesDir', 'profileDir', 'stdout', 'stderr', 'apiKey', 'symlinks', 'foreignOwned', 'containerName', 'volumeName']) {
    assert.equal(text.includes(needle), false, `response leaked ${needle}`);
  }
}

test('dry-run seat status and provision return a plan and per-seat model view with no Docker calls', async () => {
  const app = await start();
  try {
    const pod = await createPod(app);
    for (const [method, url, body] of [['GET', `/pod-instances/${pod.id}/seats/status`], ['POST', `/pod-instances/${pod.id}/seats/provision`, {}]]) {
      const response = await request(app, method, url, body);
      assert.equal(response.status, 200, response.text);
      const result = JSON.parse(response.text);
      assert.equal(result.dryRun, true);
      assert.equal(result.executed, false);
      assert.equal(result.ready, false);
      assert.deepEqual(result.seats.map((seat) => [seat.seatId, seat.model.state, seat.model.source, seat.blockers]), [['lead', 'planned', 'template', ['dry_run']], ['coder', 'planned', 'template', ['dry_run']]]);
      assert.deepEqual(result.seats[0].model.requested, MODEL);
      assert.equal(result.seats[0].profile, null);
      assert.equal(result.seats[0].auth, null);
      assert.ok(result.plan.steps.length > 0);
      assert.equal(result.plan.steps.some((step) => 'stdin' in step), false);
      assert.equal(result.plan.steps.filter((step) => step.args[0] === 'exec').every((step) => step.args[step.args.indexOf('--user') + 1] === 'hermes'), true);
      assert.equal(response.text.includes(app.config.dataDir.replaceAll('\\', '\\\\')), false);
    }
    const unconfigured = await createPod(app, null);
    const result = JSON.parse((await request(app, 'GET', `/pod-instances/${unconfigured.id}/seats/status?seatIds=coder`)).text);
    assert.deepEqual(result.seats.map((seat) => [seat.seatId, seat.model.state, seat.blockers]), [['coder', 'unconfigured', ['dry_run', 'model_unconfigured']]]);
    assert.deepEqual(app.calls, []);
  } finally { await stop(app); }
});

test('missing or invalid pods are rejected; live mode requires an existing owned running pod and never starts one', async () => {
  const dry = await start();
  try {
    assert.equal((await request(dry, 'GET', '/pod-instances/pod_00000000-0000-4000-8000-000000000000/seats/status')).status, 404);
    assert.equal((await request(dry, 'POST', '/pod-instances/pod_00000000-0000-4000-8000-000000000000/seats/provision', {})).status, 404);
    assert.equal((await request(dry, 'GET', '/pod-instances/not-a-pod/seats/status')).status, 400);
    assert.deepEqual(dry.calls, []);
  } finally { await stop(dry); }

  const live = await start({ DRY_RUN: 'false' });
  try {
    const pod = await createPod(live);
    live.podSeats.runner = liveRunner(live, pod, { missing: true });
    const response = await request(live, 'POST', `/pod-instances/${pod.id}/seats/provision`, {});
    assert.equal(response.status, 409, response.text);
    assert.match(JSON.parse(response.text).error.message, /start the pod first/);
    assert.deepEqual(live.calls.map((args) => args[0]), ['inspect'], 'only the ownership inspect ran; no exec, start, or create');
  } finally { await stop(live); }
});

test('bad seats, request-supplied models, and invalid template models are rejected before Docker', async () => {
  const app = await start({ DRY_RUN: 'false' });
  try {
    const pod = await createPod(app);
    assert.equal((await request(app, 'GET', `/pod-instances/${pod.id}/seats/status?seatIds=default`)).status, 400);
    assert.equal((await request(app, 'GET', `/pod-instances/${pod.id}/seats/status?seatIds=..%2Fceo`)).status, 400);
    assert.equal((await request(app, 'GET', `/pod-instances/${pod.id}/seats/status?seatIds=`)).status, 400);
    assert.equal((await request(app, 'GET', `/pod-instances/${pod.id}/seats/status?seatIds=ghost`)).status, 409);
    assert.equal((await request(app, 'POST', `/pod-instances/${pod.id}/seats/provision`, { seatIds: 'lead' })).status, 400);
    assert.equal((await request(app, 'POST', `/pod-instances/${pod.id}/seats/provision`, [])).status, 400);
    const injected = await request(app, 'POST', `/pod-instances/${pod.id}/seats/provision`, { seatIds: ['lead'], model: { provider: 'anthropic', default: 'x' }, apiKey: SECRET });
    assert.equal(injected.status, 400);
    assert.equal(injected.text.includes(SECRET), false);
    const badModel = await createPod(app, { provider: 'ceo-auth', default: 'gpt-5' });
    assert.equal((await request(app, 'GET', `/pod-instances/${badModel.id}/seats/status`)).status, 400);
    const extraField = await createPod(app, { ...MODEL, temperature: 0.1 });
    assert.equal((await request(app, 'POST', `/pod-instances/${extraField.id}/seats/provision`, {})).status, 400);
    assert.deepEqual(app.calls, []);
  } finally { await stop(app); }
});

test('live seat responses expose only safe per-seat model/auth readiness and blockers', async () => {
  const app = await start({ DRY_RUN: 'false' });
  try {
    const pod = await createPod(app);
    app.podSeats.runner = liveRunner(app, pod);
    const response = await request(app, 'POST', `/pod-instances/${pod.id}/seats/provision`, { seatIds: ['lead'] });
    assert.equal(response.status, 200, response.text);
    assertNoLeaks(app, response.text);
    const result = JSON.parse(response.text);
    assert.deepEqual(Object.keys(result).sort(), ['action', 'changed', 'dryRun', 'executed', 'notes', 'podId', 'ready', 'seats']);
    assert.equal(result.podId, pod.id);
    assert.equal(result.action, 'provision');
    assert.equal(result.ready, true);
    assert.equal(result.changed, true);
    assert.deepEqual(result.seats, [{
      seatId: 'lead',
      ready: true,
      blockers: [],
      profile: { state: 'ready', identity: true, writable: true, envPrivate: true, missingSubdirs: [], changed: ['.env'] },
      model: { state: 'configured', source: 'template', requested: MODEL, current: { ...MODEL, apiMode: '', baseUrlSet: false } },
      auth: { providers: { anthropic: { checked: true, authenticated: true, state: 'authenticated', message: 'Native Hermes auth reports authenticated.' } }, seatAuthFile: false, podAuthFile: true },
    }]);
    const status = await request(app, 'GET', `/pod-instances/${pod.id}/seats/status?auth=skip`);
    assert.equal(status.status, 200);
    assertNoLeaks(app, status.text);
    const inspected = JSON.parse(status.text);
    assert.equal(inspected.changed, false);
    assert.deepEqual(inspected.seats.map((seat) => [seat.seatId, seat.auth.providers.anthropic.state, seat.blockers]), [['lead', 'not_checked', ['auth_not_ready']], ['coder', 'not_checked', ['auth_not_ready']]]);
    for (const args of app.calls.filter((call) => call[0] === 'exec')) assert.equal(args[args.indexOf('--user') + 1], 'hermes');
    assert.equal(app.calls.some((args) => ['run', 'start', 'create', 'cp'].includes(args[0]) || args[1] === 'create'), false, 'no pod start or volume creation');
  } finally { await stop(app); }
});
