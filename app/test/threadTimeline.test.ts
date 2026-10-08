import test from 'node:test';
import assert from 'node:assert/strict';
import { addressLabel, buildTimeline } from '../src/threadTimeline.ts';

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
