import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';

async function start() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-http-'));
  const app = await createApp({ PORT: '3081', HOST: '127.0.0.1', DATA_DIR: dataDir, WAYPOINT_CONTROL_DIR: path.join(dataDir, 'control'), LOG_LEVEL: 'error', HERMES_AUTO_START: 'false' });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => app.bridgeServer.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}`, bridgeBase: `http://127.0.0.1:${app.bridgeServer.address().port}` };
}
async function stop(server, bridgeServer) {
  await Promise.all([server, bridgeServer].filter(Boolean).map((s) => new Promise((resolve) => s.close(resolve))));
}

test('healthz, config, and model catalog return sanitized JSON', async () => {
  const app = await start();
  try {
    const health = await fetch(`${app.base}/healthz`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.dryRun, true);
    const config = await fetch(`${app.base}/config`).then((r) => r.json());
    assert.equal(config.docker.imageConfigured, true);
    assert.equal(config.docker.imagePinned, true);
    assert.equal(Object.keys(config).includes('POD_DOCKER_IMAGE'), false);
    const catalog = await fetch(`${app.base}/hermes/model-catalog?provider=openai-codex`).then((r) => r.json());
    assert.equal(catalog.providers.length, 1);
    assert.equal(catalog.providers[0].id, 'openai-codex');
    assert.ok(catalog.providers[0].models.length > 0);
    assert.equal(JSON.stringify(catalog).includes('sk-'), false);
    const anthropic = await fetch(`${app.base}/hermes/model-catalog?provider=anthropic`).then((r) => r.json());
    assert.ok(anthropic.providers[0].models.some((m) => m.id === 'claude-opus-5-5'));
  } finally { await stop(app.server, app.bridgeServer); }
});

test('bridge requires token before exposing CEO pod tools', async () => {
  const app = await start();
  try {
    const denied = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'health', args: {} }) });
    assert.equal(denied.status, 403);
    const ok = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${app.config.bridge.token}` }, body: JSON.stringify({ tool: 'health', args: {} }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
  } finally { await stop(app.server, app.bridgeServer); }
});

test('CEO mailbox turn permits messaging while refusing control tools', async () => {
  const app = await start();
  try {
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${app.config.bridge.token}` };
    app.hermes.mailboxTurnInFlight = true;
    const control = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers, body: JSON.stringify({ tool: 'create_mission', args: { title: 'Peer injected mission' } }) });
    assert.equal(control.status, 403);
    assert.deepEqual(await app.store.listMissions(), []);
    const message = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers, body: JSON.stringify({ tool: 'inbox', args: {} }) });
    assert.equal(message.status, 200);
    app.hermes.mailboxTurnInFlight = false;
    const health = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers, body: JSON.stringify({ tool: 'health', args: {} }) });
    assert.equal(health.status, 200);
  } finally { await stop(app.server, app.bridgeServer); }
});

test('starting a pod from the CEO or the app prepares its seats and reports shared-auth readiness', async () => {
  const app = await start();
  try {
    const template = await app.store.createTemplate({ name: 'on demand', version: '1', seats: [{ id: 'builder', role: 'Builder' }], config: { model: { provider: 'openai-codex', default: 'gpt-6-luna' } } });
    const pod = await app.store.cloneTemplate(template.id, { podName: 'on-demand-test' }, ({ podId, podName }) => app.docker.startPlan({ podId, podName }));
    let provisionCalls = 0;
    let toolsInstalled = 0;
    app.docker.lifecycle = async (_instance, action) => ({ action, executed: true, dryRun: false, status: { state: 'running', running: true } });
    app.podSeats.provision = async (instance, options) => {
      provisionCalls += 1;
      assert.equal(instance.id, pod.id);
      assert.equal(options.template.id, template.id);
      return { podId: pod.id, action: 'provision', dryRun: false, executed: true, changed: true, ready: true, seats: [{
        seatId: 'builder', ready: true, blockers: [],
        profile: { state: 'ready', identity: true, writable: true, envPrivate: true, missingSubdirs: [], changed: ['.env'], path: '/opt/data/profiles/builder' },
        model: { state: 'configured', source: 'template', requested: { provider: 'openai-codex', default: 'gpt-6-luna' }, current: { provider: 'openai-codex', default: 'gpt-6-luna' } },
        auth: { providers: { 'openai-codex': { checked: true, authenticated: true, state: 'authenticated', message: 'Ready.' } }, stores: { seatAuthFile: false, podRootAuthFile: false } },
      }], notes: [] };
    };
    app.messaging.installSeatTools = async (_instance, seatIds) => { toolsInstalled += 1; assert.deepEqual(seatIds, ['builder']); };
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${app.config.bridge.token}` };
    const response = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers, body: JSON.stringify({ tool: 'pod_start', args: { podId: pod.id } }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status.running, true);
    assert.equal(result.seats.ready, true);
    assert.equal(result.seats.seats[0].auth.providers['openai-codex'].authenticated, true);
    assert.equal(JSON.stringify(result).includes('/opt/data/profiles/builder'), false);
    assert.equal(provisionCalls, 1);
    assert.equal(toolsInstalled, 1);

    const fromApp = await fetch(`${app.base}/pod-instances/${pod.id}/lifecycle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start' }) });
    assert.equal(fromApp.status, 200);
    assert.equal((await fromApp.json()).seats.ready, true, 'starting from the app prepares seats like pod_start');
    assert.equal(provisionCalls, 2);
    assert.equal(toolsInstalled, 2);

    app.docker.lifecycle = async () => ({ action: 'start', executed: false, dryRun: true, plan: app.docker.startPlan({ podId: pod.id, podName: pod.podName }) });
    const preview = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers, body: JSON.stringify({ tool: 'pod_start', args: { podId: pod.id } }) }).then((r) => r.json());
    assert.equal(preview.dryRun, true);
    assert.equal(provisionCalls, 2);
    assert.equal(toolsInstalled, 2);
  } finally { await stop(app.server, app.bridgeServer); }
});

test('CEO pod_start snapshots the CEO model when a pod has no model of its own', async () => {
  const app = await start();
  try {
    const template = await app.store.createTemplate({ name: 'inherit model', version: '1', seats: [{ id: 'lead', role: 'Lead' }, { id: 'builder', role: 'Builder' }] });
    const pod = await app.store.cloneTemplate(template.id, { podName: 'inherit-model-test' }, ({ podId, podName }) => app.docker.startPlan({ podId, podName }));
    await app.store.setSeatModel(pod.id, 'builder', { provider: 'anthropic', default: 'claude-opus-5-5' });
    app.config.dryRun = false;
    let ceoReads = 0;
    app.hermes.status = async () => { ceoReads += 1; return { model: { configured: true, provider: 'openai-codex', default: 'gpt-6-luna', api_mode: '', base_url: '' } }; };
    app.docker.lifecycle = async (_instance, action) => ({ action, executed: true, dryRun: false, status: { state: 'running', running: true } });
    app.podSeats.provision = async (instance, { template: storedTemplate }) => {
      assert.equal(storedTemplate.id, template.id);
      assert.equal(instance.model.provider, 'openai-codex');
      assert.equal(instance.model.default, 'gpt-6-luna');
      assert.equal(instance.seats.find((seat) => seat.id === 'builder').model.provider, 'anthropic');
      return { podId: pod.id, action: 'provision', dryRun: false, executed: true, changed: true, ready: true, seats: [], notes: [] };
    };
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${app.config.bridge.token}` };
    const callStart = () => fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers, body: JSON.stringify({ tool: 'pod_start', args: { podId: pod.id } }) });
    assert.equal((await callStart()).status, 200);
    assert.equal((await callStart()).status, 200);
    assert.equal(ceoReads, 1, 'restarting a pod keeps its captured default model');
    const saved = await app.store.getInstance(pod.id);
    assert.equal(saved.model.provider, 'openai-codex');
    assert.equal(saved.seats.find((seat) => seat.id === 'builder').model.provider, 'anthropic');
  } finally { await stop(app.server, app.bridgeServer); }
});

test('CEO conversation HTTP endpoints expose only the agreed contract', async () => {
  const app = await start();
  try {
    app.hermes.ceoConversation = async () => ({ sessionId: null, messages: [] });
    app.hermes.sendCeoMessage = async (body) => ({ sessionId: 'sess_http', reply: `echo:${body.message}`, messages: [
      { role: 'user', text: body.message, at: '2026-10-06T00:00:00.000Z' },
      { role: 'ceo', text: `echo:${body.message}`, at: '2026-10-06T00:00:01.000Z' },
    ] });
    const conversation = await fetch(`${app.base}/hermes/ceo/conversation`).then((r) => r.json());
    assert.deepEqual(conversation, { sessionId: null, messages: [] });
    const turn = await fetch(`${app.base}/hermes/ceo/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hello' }),
    }).then((r) => r.json());
    assert.equal(turn.sessionId, 'sess_http');
    assert.equal(turn.reply, 'echo:hello');
    assert.deepEqual(turn.messages.map((m) => m.role), ['user', 'ceo']);
    assert.equal(Object.keys(turn).sort().join(','), 'messages,reply,sessionId');
  } finally { await stop(app.server, app.bridgeServer); }
});

test('Hermes skill HTTP routes expose all skills, safe detail, and toggle errors', async () => {
  const app = await start();
  try {
    const skill = { name: 'spike', description: 'Experiment safely.', category: 'software-development', source: 'builtin', enabled: false, locked: false, waypoint: false };
    const bridge = { name: 'waypoint-ceo-bridge', description: 'Bridge.', category: '', source: 'local', enabled: true, locked: true, waypoint: true };
    app.hermes.skills = async () => ({ available: true, runtime: { running: true, state: 'running' }, skills: [skill, bridge], counts: { total: 2, enabled: 1, disabled: 1, locked: 1, builtin: 1, local: 1, hub: 0 }, scope: 'ceo' });
    app.hermes.skill = async (name) => {
      if (name !== 'spike') throw Object.assign(new Error('Hermes skill not found'), { status: 404, code: 'not_found' });
      return { available: true, skill: { ...skill, overview: 'No secrets here.', files: [{ name: 'SKILL.md', size: 120 }] } };
    };
    app.hermes.setSkillEnabled = async (name, body) => {
      if (typeof body.enabled !== 'boolean') throw Object.assign(new Error('enabled must be a boolean'), { status: 400, code: 'bad_request' });
      if (name === 'waypoint-ceo-bridge' && body.enabled === false) throw Object.assign(new Error('This Hermes skill is locked and cannot be disabled from Waypoint.'), { status: 409, code: 'conflict', details: { name } });
      if (name !== 'spike') throw Object.assign(new Error('Hermes skill not found'), { status: 404, code: 'not_found', details: { name } });
      return { available: true, skill: { ...skill, enabled: Boolean(body.enabled) }, skills: [{ ...skill, enabled: Boolean(body.enabled) }, bridge], counts: { total: 2, enabled: body.enabled ? 2 : 1, disabled: body.enabled ? 0 : 1, locked: 1, builtin: 1, local: 1, hub: 0 } };
    };
    const list = await fetch(`${app.base}/hermes/skills`).then((r) => r.json());
    assert.deepEqual(list.skills.map((s) => [s.name, s.enabled, s.locked]), [['spike', false, false], ['waypoint-ceo-bridge', true, true]]);
    assert.equal(list.counts.disabled, 1);
    const detail = await fetch(`${app.base}/hermes/skills/spike`).then((r) => r.json());
    assert.deepEqual(detail.skill.files, [{ name: 'SKILL.md', size: 120 }]);
    assert.equal(JSON.stringify(detail).includes('secret-token'), false);
    const enabled = await fetch(`${app.base}/hermes/skills/spike`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    assert.equal(enabled.status, 200);
    assert.equal((await enabled.json()).skill.enabled, true);
    const locked = await fetch(`${app.base}/hermes/skills/waypoint-ceo-bridge`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
    assert.equal(locked.status, 409);
    const unknown = await fetch(`${app.base}/hermes/skills/missing`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
    assert.equal(unknown.status, 404);
    const badBody = await fetch(`${app.base}/hermes/skills/spike`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: 'false' }) });
    assert.equal(badBody.status, 400);
  } finally { await stop(app.server, app.bridgeServer); }
});

test('HTTP API creates templates, clones pods, delegates tasks, and structures errors', async () => {
  const app = await start();
  try {
    const templateRes = await fetch(`${app.base}/pod-templates`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ops', version: '1', seats: [{ id: 'coder', role: 'code' }], baselineFiles: { 'SOUL.md': 'guide' } }),
    });
    assert.equal(templateRes.status, 201);
    const template = await templateRes.json();
    const cloneRes = await fetch(`${app.base}/pod-templates/${template.id}/clone`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ podName: 'delta' }),
    });
    assert.equal(cloneRes.status, 201);
    const pod = await cloneRes.json();
    assert.equal(pod.state, 'planned');
    assert.match(pod.dockerPlan.notes.join(' '), /no per-seat Hermes gateway launch/i);
    assert.ok(pod.dockerPlan.args.includes('--mount'));
    assert.ok(pod.dockerPlan.args.some((arg) => arg === `type=volume,source=${pod.dockerPlan.volumeName},target=/opt/data`));
    assert.equal(JSON.stringify(pod.dockerPlan).includes('type=bind'), false);
    assert.equal(pod.planSource, 'derived-from-service-config');
    const taskRes = await fetch(`${app.base}/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ podId: pod.id, seatId: 'coder', summary: 'work' }),
    });
    assert.equal(taskRes.status, 201);
    assert.equal((await taskRes.json()).state, 'delegated');
    const media = await fetch(`${app.base}/pod-templates`, { method: 'POST', body: '{}' });
    assert.equal(media.status, 415);
    const foreign = await fetch(`${app.base}/pod-templates`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' });
    assert.equal(foreign.status, 403);
    const bad = await fetch(`${app.base}/pod-templates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(bad.status, 400);
    const error = await bad.json();
    assert.equal(error.error.code, 'bad_request');
    assert.equal(JSON.stringify(error).includes('stack'), false);
  } finally { await stop(app.server, app.bridgeServer); }
});
