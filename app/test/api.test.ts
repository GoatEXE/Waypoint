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

  assert.equal(calls[0].url, '/api/hermes/ceo/conversation?threadId=general');
  assert.equal(calls[1].url, '/api/hermes/ceo/messages');
  assert.equal(calls[1].init?.method, 'POST');
  assert.equal(calls[1].init?.body, JSON.stringify({ message: 'Do this', threadId: 'general' }));
  await api.ceoConversation('task_1');
  assert.equal(calls[2].url, '/api/hermes/ceo/conversation?threadId=task_1');
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

test('board task APIs use the agreed endpoints', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, text: async () => JSON.stringify({ id: 't_1a2b3c4d', ref: 'ORT-1', status: 'review' }) } as Response;
  }) as typeof fetch;

  await api.task('ORT-1');
  await api.commentTask('ORT-1', 'Please add a test');
  await api.taskAction('ORT-1', { action: 'complete' });
  assert.deepEqual(calls.map(call => [call.url, call.init?.method, call.init?.body]), [
    ['/api/tasks/ORT-1', undefined, undefined],
    ['/api/tasks/ORT-1/comments', 'POST', JSON.stringify({ text: 'Please add a test' })],
    ['/api/tasks/ORT-1/actions', 'POST', JSON.stringify({ action: 'complete' })],
  ]);
});


test('API helper surfaces exact server errors and preserves not-found status', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ error: { message: 'CEO is busy' } }) }) as Response) as typeof fetch;
  await assert.rejects(() => api.sendCeoMessage('hello'), /CEO is busy/);

  globalThis.fetch = (async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'task not found' } }) }) as Response) as typeof fetch;
  await assert.rejects(async () => api.task('task_missing'), (error) => isNotFoundError(error) && /task not found/.test(String((error as Error).message)));
});

