import test from 'node:test';
import assert from 'node:assert/strict';
import { addressLabel, buildTimeline, deliveryLabel, generalThreadMessages } from '../src/threadTimeline.ts';

test('buildTimeline interleaves chat, seat runs, and linked messages by time', () => {
  const chat = [
    { role: 'user' as const, text: 'Run it', at: '2026-10-07T10:00:00Z' },
    { role: 'ceo' as const, text: 'Started', at: '2026-10-07T10:00:05Z' },
  ];
  const timeline = buildTimeline(chat, {
    seatId: 'builder',
    runs: [
      { id: 'run_1', state: 'running', startedAt: '2026-10-07T10:00:03Z' },
      { id: 'run_0', state: 'aborted', startedAt: '2026-10-07T09:00:00Z' },
    ],
    live: { runId: 'run_1', items: [{ kind: 'tool', name: 'terminal', detail: 'ls', status: 'running' }] },
    messages: [{ id: 'msg_1', from: 'pod_1/builder', to: 'ceo', text: 'Halfway', taskId: 'task_1', createdAt: '2026-10-07T10:00:04Z', readAt: null, wake: null }],
  });
  assert.deepEqual(timeline.map(e => e.kind), ['chat', 'run', 'peer', 'chat']);
  const run = timeline[1];
  assert.equal(run.kind === 'run' && run.live?.length, 1);
  assert.deepEqual(buildTimeline(chat, null).map(e => e.kind), ['chat', 'chat']);
});

test('addressLabel names the CEO and seats', () => {
  assert.equal(addressLabel('ceo', 'Jeff'), 'Jeff');
  assert.equal(addressLabel('pod_1/builder', 'Jeff'), 'builder');
});

test('the General thread shows untasked CEO messages and delivery labels follow wake state', () => {
  const base = { text: 'hi', createdAt: '2026-10-07T00:00:00Z', readAt: null, wake: null };
  const messages = [
    { ...base, id: 'a', from: 'ceo', to: 'pod_x/lead', taskId: null },
    { ...base, id: 'b', from: 'pod_x/lead', to: 'ceo', taskId: null, replyTo: 'a' },
    { ...base, id: 'c', from: 'ceo', to: 'pod_x/lead', taskId: 'task_1' },
    { ...base, id: 'd', from: 'pod_x/lead', to: 'pod_y/dev', taskId: null },
  ];
  assert.deepEqual(generalThreadMessages(messages).map(m => m.id), ['a', 'b']);
  const wake = (state: string) => ({ state, depth: 0, attempts: 1 });
  assert.deepEqual(deliveryLabel({ wake: wake('completed'), readAt: null }), { label: 'answered', tone: 'ok' });
  assert.deepEqual(deliveryLabel({ wake: wake('outcome_unknown'), readAt: null }), { label: 'failed', tone: 'err' });
  assert.deepEqual(deliveryLabel({ wake: wake('running'), readAt: null }), { label: 'running', tone: 'wait' });
  assert.deepEqual(deliveryLabel({ wake: wake('queued'), readAt: null }), { label: 'queued', tone: 'wait' });
  assert.deepEqual(deliveryLabel({ wake: wake('suppressed'), readAt: '2026-10-07T00:01:00Z' }), { label: 'read', tone: 'ok' });
});
