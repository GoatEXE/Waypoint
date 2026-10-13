import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileData, READ_USER_MEMORY_SCRIPT, USAGE_SCRIPT, WRITE_USER_MEMORY_SCRIPT } from '../src/profileData.js';

function fakeHermes({ running = true, stdout = '{}' } = {}) {
  const calls = [];
  return {
    calls,
    inspect: async () => ({ exists: running, state: { running } }),
    execPython: async (script, input) => { calls.push({ script, input: JSON.parse(input) }); return { code: 0, stdout: typeof stdout === 'function' ? stdout() : stdout, stderr: '' }; },
  };
}

test('usage is unavailable while the CEO is stopped', async () => {
  const hermes = fakeHermes({ running: false });
  const usage = await new ProfileData({ hermes }).usage();
  assert.equal(usage.available, false);
  assert.deepEqual(usage.days, []);
  assert.equal(hermes.calls.length, 0);
});

test('usage reads every agent and board read-only with the browser time zone', async () => {
  const hermes = fakeHermes({ stdout: JSON.stringify({ days: [{ day: 20739, tasks: 2 }], agents: ['ceo'], billing: { apiKey: false, subscription: true, providers: [] }, unreadable: [] }) });
  const usage = await new ProfileData({ hermes }).usage({ tzOffsetMinutes: '-120' });
  assert.equal(usage.available, true);
  assert.equal(usage.days[0].tasks, 2);
  assert.equal(hermes.calls[0].script, USAGE_SCRIPT);
  assert.deepEqual(hermes.calls[0].input, { tzOffsetMinutes: -120 });
  assert.match(USAGE_SCRIPT, /mode=ro/);
  assert.doesNotMatch(USAGE_SCRIPT, /INSERT|UPDATE|DELETE/);
  await assert.rejects(new ProfileData({ hermes }).usage({ tzOffsetMinutes: 'abc' }), /tz must be/);
});

test('USER.md reads and writes go through Hermes memory with a stale check', async () => {
  const hermes = fakeHermes({ stdout: JSON.stringify({ entries: ['Name: Ada'], used: 9, limit: 1375, enabled: true }) });
  const data = new ProfileData({ hermes });
  const memory = await data.userMemory();
  assert.deepEqual(memory, { available: true, entries: ['Name: Ada'], used: 9, limit: 1375, enabled: true });
  assert.equal(hermes.calls[0].script, READ_USER_MEMORY_SCRIPT);

  hermes.calls.length = 0;
  const writer = fakeHermes({ stdout: JSON.stringify({ ok: true, entries: ['Name: Ada', 'Likes tea'], used: 21, limit: 1375, enabled: true }) });
  const saved = await new ProfileData({ hermes: writer }).saveUserMemory({ entries: ['Name: Ada', 'Likes tea'], base: ['Name: Ada'] });
  assert.deepEqual(saved.entries, ['Name: Ada', 'Likes tea']);
  assert.equal(writer.calls[0].script, WRITE_USER_MEMORY_SCRIPT);
  assert.deepEqual(writer.calls[0].input, { entries: ['Name: Ada', 'Likes tea'], base: ['Name: Ada'] });
  assert.match(WRITE_USER_MEMORY_SCRIPT, /_mutate\('user'/);
});

test('USER.md save errors are plain', async () => {
  const stale = fakeHermes({ stdout: JSON.stringify({ ok: false, code: 'stale', error: 'USER.md changed since you opened it.' }) });
  await assert.rejects(new ProfileData({ hermes: stale }).saveUserMemory({ entries: ['a'], base: [] }), (e) => e.status === 409 && /changed since/.test(e.message));
  const limit = fakeHermes({ stdout: JSON.stringify({ ok: false, code: 'limit', error: 'USER.md would be 2000 of 1375 characters.' }) });
  await assert.rejects(new ProfileData({ hermes: limit }).saveUserMemory({ entries: ['a'] }), (e) => e.status === 400 && /2000 of 1375/.test(e.message));
  await assert.rejects(new ProfileData({ hermes: fakeHermes() }).saveUserMemory({ entries: 'nope' }), /entries must be/);
  await assert.rejects(new ProfileData({ hermes: fakeHermes() }).saveUserMemory({ entries: [], extra: 1 }), /body must be/);
  await assert.rejects(new ProfileData({ hermes: fakeHermes({ running: false }) }).saveUserMemory({ entries: [] }), (e) => e.status === 409 && /Start the CEO/.test(e.message));
});
