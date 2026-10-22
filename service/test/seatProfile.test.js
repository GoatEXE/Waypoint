import test from 'node:test';
import assert from 'node:assert/strict';
import { OrgSeats } from '../src/orgSeats.js';
import { fakeHermes } from './fakeHermes.js';

function seats() {
  const calls = [];
  const writes = [];
  const hermes = fakeHermes({
    runner: async (command, args) => { calls.push([command, ...args]); return { code: 0, stdout: '', stderr: '' }; },
    execPython: async (script, input) => {
      const p = JSON.parse(input);
      if (p.files) { writes.push(p.write); return { stdout: JSON.stringify({ ok: true, soul: p.write.soul ?? 'soul', memory: '', user: 'u', model: { provider: 'anthropic', default: 'claude-opus-5-5' } }) }; }
      return { stdout: JSON.stringify({ seats: [{ id: 'dev', description: 'Builds things', autoLoad: ['waypoint-seat'] }] }) };
    },
  });
  return { orgSeats: new OrgSeats({ config: {}, hermes }), calls, writes };
}

test('a seat profile reads its description, files, and model', async () => {
  const { orgSeats } = seats();
  assert.deepEqual(await orgSeats.profile('dev'), { id: 'dev', description: 'Builds things', soul: 'soul', memory: '', user: 'u', model: { provider: 'anthropic', default: 'claude-opus-5-5' } });
});

test('seat edits write files, describe the profile, and set the model', async () => {
  const { orgSeats, calls, writes } = seats();
  await orgSeats.updateProfile('dev', { soul: 'Be brief.', description: 'Ships code', model: { provider: 'openai-codex', default: 'gpt-6-sol' } });
  assert.deepEqual(writes.find((w) => Object.keys(w).length), { soul: 'Be brief.' });
  const joined = calls.map((c) => c.join(' '));
  assert.ok(joined.includes('hermes profile describe dev --text Ships code'));
  assert.ok(joined.includes('hermes -p dev config set model.provider openai-codex'));
  assert.ok(joined.includes('hermes -p dev config set model.api_mode codex_responses'));
  await assert.rejects(orgSeats.updateProfile('dev', { model: { provider: 'other', default: 'x' } }), /not supported/);
  await assert.rejects(orgSeats.updateProfile('dev', { secrets: 'x' }), /unsupported/);
  await assert.rejects(orgSeats.updateProfile('Bad', { soul: 'x' }), /seat id/);
});
