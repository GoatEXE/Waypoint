import test from 'node:test';
import assert from 'node:assert/strict';
import { api, isNotFoundError } from '../src/api.ts';

test('GET API helper deduplicates identical in-flight status requests but keeps explicit refresh distinct', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, text: async () => JSON.stringify({ runtime: { running: false, state: 'missing' }, model: { configured: false }, auth: {} }) } as Response;
  }) as typeof fetch;

  await Promise.all([api.hermesStatus(), api.hermesStatus()]);
  assert.deepEqual(calls, ['/api/hermes/status']);

  await api.hermesStatus({ freshAuth: true });
  assert.deepEqual(calls, ['/api/hermes/status', '/api/hermes/status?nativeAuth=fresh']);
});

test('CEO conversation API uses the agreed GET and POST contract', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = String(url).endsWith('/messages')
      ? { sessionId: 's1', reply: 'Accepted.', messages: [{ role: 'user', text: 'Do this', at: '2026-01-01T00:00:00Z' }, { role: 'ceo', text: 'Accepted.', at: '2026-01-01T00:00:01Z' }] }
      : { sessionId: 's1', messages: [] };
    return { ok: true, text: async () => JSON.stringify(body) } as Response;
  }) as typeof fetch;

  assert.deepEqual(await api.ceoConversation(), { sessionId: 's1', messages: [] });
  await api.sendCeoMessage('Do this');

  assert.equal(calls[0].url, '/api/hermes/ceo/conversation');
  assert.equal(calls[1].url, '/api/hermes/ceo/messages');
  assert.equal(calls[1].init?.method, 'POST');
  assert.equal(calls[1].init?.body, JSON.stringify({ message: 'Do this' }));
});

test('skills API lists all installed skills and toggles one skill availability', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const skill = { name: 'writer', description: 'Write files', category: 'files', source: 'local', enabled: false, locked: false };
    const body = init?.method === 'PUT'
      ? { ...skill, enabled: true }
      : { available: true, runtime: { running: true, state: 'running' }, skills: [skill], counts: { total: 1, enabled: 0, disabled: 1, builtin: 0, local: 1, hub: 0 } };
    return { ok: true, text: async () => JSON.stringify(body) } as Response;
  }) as typeof fetch;

  const inv = await api.hermesSkills();
  const updated = await api.setHermesSkillEnabled('writer', true);

  assert.equal(inv.skills[0].enabled, false);
  assert.equal(calls[0].url, '/api/hermes/skills');
  assert.equal(calls[1].url, '/api/hermes/skills/writer');
  assert.equal(calls[1].init?.method, 'PUT');
  assert.equal(calls[1].init?.body, JSON.stringify({ enabled: true }));
  assert.deepEqual(updated, { ...inv.skills[0], enabled: true });
});

test('pod, task, and task-run APIs use the agreed endpoints', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = String(url).includes('/pod-instances/')
      ? { id: 'pod_1', podName: 'finish-waypoint-01', templateId: 'tpl_1', state: 'planned', seats: [{ id: 'lead', role: 'Lead' }] }
      : String(url).endsWith('/run')
        ? { taskId: 'task_1', runId: 'run_1', state: 'running', message: 'Run claimed and executing in the background; poll the task for its outcome.' }
        : { id: 'task_1', podId: 'pod_1', seatId: 'lead', summary: 'Finish Waypoint', state: 'delegated', evidence: [{ type: 'record', message: 'Delegation recorded only; no Hermes execution performed.', at: '2026-10-06T00:00:00.000Z' }], createdAt: '', updatedAt: '' };
    return { ok: true, text: async () => JSON.stringify(body) } as Response;
  }) as typeof fetch;

  assert.equal((await api.podInstance('pod_1')).podName, 'finish-waypoint-01');
  assert.equal((await api.task('task_1')).state, 'delegated');
  assert.equal((await api.runTask('task_1')).state, 'running');
  assert.deepEqual(calls.map(call => [call.url, call.init?.method, call.init?.body]), [
    ['/api/pod-instances/pod_1', undefined, undefined],
    ['/api/tasks/task_1', undefined, undefined],
    ['/api/tasks/task_1/run', 'POST', '{}'],
  ]);
});


test('pod setup APIs cover lifecycle, seat readiness, model, login, and seat key routes', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const text = String(url);
    const body = text.endsWith('/config') ? { dryRun: true }
      : text.endsWith('/lifecycle') ? { action: 'start', dryRun: true, executed: false }
      : text.includes('/seats/status') || text.endsWith('/seats/provision') ? { podId: 'pod_1', dryRun: true, seats: [{ seatId: 'lead', ready: false, blockers: ['dry_run'], profile: null, model: { state: 'planned', requested: { provider: 'anthropic', default: 'claude-sonnet-5' } }, auth: null }] }
      : text.endsWith('/model') ? { podId: 'pod_1', podName: 'p', seat: { id: 'lead', role: 'Lead', model: { provider: 'anthropic', default: 'claude-sonnet-5' } } }
      : text.includes('/login/') && text.endsWith('/code') ? { id: 'login_1', podId: 'pod_1', seatId: 'lead', provider: 'anthropic', flow: 'authorization-code', state: 'authorized', authUrl: '', userCode: '', requiresCode: false, startedAt: '', updatedAt: '', message: 'ok' }
      : text.endsWith('/login/login_1') ? { id: 'login_1', podId: 'pod_1', seatId: 'lead', provider: 'anthropic', flow: 'authorization-code', state: init?.method === 'DELETE' ? 'cancelled' : 'pending', authUrl: '', userCode: '', requiresCode: false, startedAt: '', updatedAt: '', message: 'ok' }
      : text.endsWith('/login') ? { id: 'login_1', podId: 'pod_1', seatId: 'lead', provider: 'anthropic', flow: 'authorization-code', state: 'pending', authUrl: 'https://example.invalid', userCode: '', requiresCode: true, startedAt: '', updatedAt: '', message: 'ok' }
      : text.endsWith('/api-key') ? { podId: 'pod_1', seatId: 'lead', provider: 'anthropic', configured: true, credentialPresent: true, authMode: 'api-key', message: 'saved' }
      : {};
    return { ok: true, text: async () => JSON.stringify(body) } as Response;
  }) as typeof fetch;

  await api.config();
  await api.podLifecycle('pod_1', 'start');
  await api.podSeatStatus('pod_1', { seatIds: ['lead'], skipAuth: true });
  await api.provisionPodSeats('pod_1', ['lead']);
  await api.saveSeatModel('pod_1', 'lead', { provider: 'anthropic', default: 'claude-sonnet-5' });
  const login = await api.startSeatLogin('pod_1', 'lead', 'anthropic', 'authorization-code');
  await api.getSeatLogin('pod_1', 'lead', 'anthropic', login.id);
  await api.submitSeatLoginCode('pod_1', 'lead', 'anthropic', login.id, 'code-1234');
  await api.cancelSeatLogin('pod_1', 'lead', 'anthropic', login.id);
  await api.saveSeatApiKey('pod_1', 'lead', 'anthropic', 'sk-test-123');

  assert.deepEqual(calls.map(call => [call.url, call.init?.method, call.init?.body]), [
    ['/api/config', undefined, undefined],
    ['/api/pod-instances/pod_1/lifecycle', 'POST', JSON.stringify({ action: 'start' })],
    ['/api/pod-instances/pod_1/seats/status?seatIds=lead&auth=skip', undefined, undefined],
    ['/api/pod-instances/pod_1/seats/provision', 'POST', JSON.stringify({ seatIds: ['lead'] })],
    ['/api/pod-instances/pod_1/seats/lead/model', 'PUT', JSON.stringify({ model: { provider: 'anthropic', default: 'claude-sonnet-5' } })],
    ['/api/pod-instances/pod_1/seats/lead/providers/anthropic/login', 'POST', JSON.stringify({ flow: 'authorization-code' })],
    ['/api/pod-instances/pod_1/seats/lead/providers/anthropic/login/login_1', undefined, undefined],
    ['/api/pod-instances/pod_1/seats/lead/providers/anthropic/login/login_1/code', 'POST', JSON.stringify({ code: 'code-1234' })],
    ['/api/pod-instances/pod_1/seats/lead/providers/anthropic/login/login_1', 'DELETE', '{}'],
    ['/api/pod-instances/pod_1/seats/lead/providers/anthropic/api-key', 'PUT', JSON.stringify({ apiKey: 'sk-test-123' })],
  ]);
});

test('API helper surfaces exact server errors and preserves not-found status', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ error: { message: 'CEO is busy' } }) }) as Response) as typeof fetch;
  await assert.rejects(() => api.sendCeoMessage('hello'), /CEO is busy/);

  globalThis.fetch = (async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'task not found' } }) }) as Response) as typeof fetch;
  await assert.rejects(async () => api.task('task_missing'), (error) => isNotFoundError(error) && /task not found/.test(String((error as Error).message)));
});
