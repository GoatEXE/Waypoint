import test from 'node:test';
import assert from 'node:assert/strict';
import { ceoLoadSucceeded, ceoSendFailed, ceoSendStarted, ceoSendSucceeded, emptyCeoState } from '../src/ceoConversation.ts';

test('failed CEO send keeps user text for manual review outside durable history', () => {
  const sending = ceoSendStarted(emptyCeoState, 'Ship the plan');
  const failed = ceoSendFailed(sending, 'CEO unavailable');

  assert.equal(failed.messages.length, 0);
  assert.equal(failed.pendingMessage, null);
  assert.equal(failed.failedMessage, 'Ship the plan');
  assert.equal(failed.sendError, 'CEO unavailable');
});

test('refresh keeps failed user text until durable history contains the user and a CEO reply', () => {
  const failed = ceoSendFailed(ceoSendStarted(emptyCeoState, 'Ship the plan'), 'timeout');
  const stillUnknown = ceoLoadSucceeded(failed, { sessionId: 's1', messages: [] });
  assert.equal(stillUnknown.failedMessage, 'Ship the plan');

  const userOnly = ceoLoadSucceeded(failed, { sessionId: 's1', messages: [{ role: 'user', text: 'Ship the plan', at: '2026-01-01T00:00:00Z' }] });
  assert.equal(userOnly.failedMessage, 'Ship the plan');
  assert.equal(userOnly.sendError, 'timeout');

  const confirmed = ceoLoadSucceeded(failed, { sessionId: 's1', messages: [
    { role: 'user', text: 'Ship the plan', at: '2026-01-01T00:00:00Z' },
    { role: 'ceo', text: 'Accepted.', at: '2026-01-01T00:00:01Z' },
  ] });
  assert.equal(confirmed.failedMessage, null);
  assert.equal(confirmed.sendError, null);
});

test('refresh uses latest matching user turn and preserves unknown outcome despite older identical confirmed turn', () => {
  const failed = ceoSendFailed(ceoSendStarted(emptyCeoState, 'Ship the plan'), 'timeout');
  const reconciled = ceoLoadSucceeded(failed, { sessionId: 's1', messages: [
    { role: 'user', text: 'Ship the plan', at: '2026-01-01T00:00:00Z', status: 'sent' },
    { role: 'ceo', text: 'Earlier confirmed reply.', at: '2026-01-01T00:00:01Z', status: 'confirmed' },
    { role: 'user', text: 'Ship the plan', at: '2026-01-01T00:01:00Z', status: 'outcome_unknown' },
    { role: 'ceo', text: 'Reply not confirmed.', at: '2026-01-01T00:01:01Z', status: 'outcome_unknown' },
  ] });

  assert.equal(reconciled.failedMessage, 'Ship the plan');
  assert.equal(reconciled.sendError, 'timeout');
});

test('refresh clears failed text for latest matching sent user and confirmed CEO reply', () => {
  const failed = ceoSendFailed(ceoSendStarted(emptyCeoState, 'Ship the plan'), 'timeout');
  const reconciled = ceoLoadSucceeded(failed, { sessionId: 's1', messages: [
    { role: 'user', text: 'Ship the plan', at: '2026-01-01T00:00:00Z', status: 'outcome_unknown' },
    { role: 'ceo', text: 'Reply not confirmed.', at: '2026-01-01T00:00:01Z', status: 'outcome_unknown' },
    { role: 'user', text: 'Ship the plan', at: '2026-01-01T00:01:00Z', status: 'sent' },
    { role: 'ceo', text: 'Accepted.', at: '2026-01-01T00:01:01Z', status: 'confirmed' },
  ] });

  assert.equal(reconciled.failedMessage, null);
  assert.equal(reconciled.sendError, null);
});

test('accepted CEO send replaces pending state with durable server messages only', () => {
  const sending = ceoSendStarted(emptyCeoState, 'Ship the plan');
  const accepted = ceoSendSucceeded(sending, {
    sessionId: 's1',
    reply: 'Accepted.',
    messages: [
      { role: 'user', text: 'Ship the plan', at: '2026-01-01T00:00:00Z' },
      { role: 'ceo', text: 'Accepted.', at: '2026-01-01T00:00:01Z' },
    ],
  });

  assert.equal(accepted.sessionId, 's1');
  assert.equal(accepted.pendingMessage, null);
  assert.equal(accepted.failedMessage, null);
  assert.deepEqual(accepted.messages.map(m => m.role), ['user', 'ceo']);
});
