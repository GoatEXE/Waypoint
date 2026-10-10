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
    assert.equal(config.hermes.imagePinned, true);
    assert.equal(Object.keys(config).includes('HERMES_DOCKER_IMAGE'), false);
    const catalog = await fetch(`${app.base}/hermes/model-catalog?provider=openai-codex`).then((r) => r.json());
    assert.equal(catalog.providers.length, 1);
    assert.equal(catalog.providers[0].id, 'openai-codex');
    assert.ok(catalog.providers[0].models.length > 0);
    assert.equal(JSON.stringify(catalog).includes('sk-'), false);
    const anthropic = await fetch(`${app.base}/hermes/model-catalog?provider=anthropic`).then((r) => r.json());
    assert.ok(anthropic.providers[0].models.some((m) => m.id === 'claude-opus-5-5'));
  } finally { await stop(app.server, app.bridgeServer); }
});

test('bridge requires the CEO token', async () => {
  const app = await start();
  try {
    const denied = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'health', args: {} }) });
    assert.equal(denied.status, 403);
    const ok = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${app.config.bridge.token}` }, body: JSON.stringify({ tool: 'health', args: {} }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
    app.board.list = async () => ({ tasks: [{ id: 't_1a2b3c4d', ref: 'SUN-1', title: 'Audit', body: 'long brief', status: 'done', assignee: 'explorer' }] });
    const tasks = await fetch(`${app.bridgeBase}/bridge/tools`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${app.config.bridge.token}` }, body: JSON.stringify({ tool: 'list_tasks', args: {} }) }).then((r) => r.json());
    assert.deepEqual(tasks, { tasks: [{ id: 't_1a2b3c4d', ref: 'SUN-1', title: 'Audit', status: 'done', assignee: 'explorer' }] }, 'the CEO can map refs to board ids');
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

test('CEO threads list General first, then every board task as a thread by latest activity', async () => {
  const app = await start();
  try {
    app.board.list = async () => ({ tasks: [
      { id: 't_aaaaaaaa', ref: 'SUN-1', title: 'Older task', status: 'running', createdAt: '2026-10-06T00:00:00.000Z' },
      { id: 't_bbbbbbbb', ref: 'SUN-2', title: 'Newer task', status: 'todo', createdAt: '2026-10-07T00:00:00.000Z' },
      { id: 't_cccccccc', ref: 'SUN-3', title: 'Archived', status: 'archived', createdAt: '2026-10-08T00:00:00.000Z' },
    ] });
    app.hermes.listCeoThreads = async () => ({ busyThreadId: 't_aaaaaaaa', threads: [
      { threadId: 'general', messageCount: 4, updatedAt: '2026-10-06T00:00:00.000Z', lastText: 'hi' },
      { threadId: 't_aaaaaaaa', messageCount: 2, updatedAt: '2999-01-01T00:00:00.000Z', lastText: 'talked' },
    ] });
    const body = await fetch(`${app.base}/hermes/ceo/threads`).then((r) => r.json());
    assert.equal(body.busyThreadId, 't_aaaaaaaa');
    assert.deepEqual(body.threads.map((t) => [t.threadId, t.title, t.ref, t.messageCount]), [['general', 'General', null, 4], ['t_aaaaaaaa', 'Older task', 'SUN-1', 2], ['t_bbbbbbbb', 'Newer task', 'SUN-2', 0]]);
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

