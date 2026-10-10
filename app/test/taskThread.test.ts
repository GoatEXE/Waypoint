import test from 'node:test';
import assert from 'node:assert/strict';
import { activityPollMs, threadEntries } from '../src/taskThread.ts';

const event = (kind: string, at: string, detail = '') => ({ kind, at, runId: 1, detail });

test('consecutive heartbeats collapse to one count with the latest time', () => {
  const entries = threadEntries({
    comments: [{ author: 'user', body: 'hi', at: '2026-01-01T00:00:03Z' }],
    events: [event('claimed', '2026-01-01T00:00:00Z'), event('heartbeat', '2026-01-01T00:00:01Z'), event('heartbeat', '2026-01-01T00:00:02Z'), event('heartbeat', '2026-01-01T00:00:04Z'), event('completed', '2026-01-01T00:00:05Z', 'Done')],
  });
  assert.deepEqual(entries, [
    { kind: 'event', at: '2026-01-01T00:00:00Z', text: 'claimed' },
    { kind: 'heartbeats', at: '2026-01-01T00:00:02Z', count: 2 },
    { kind: 'comment', at: '2026-01-01T00:00:03Z', author: 'user', body: 'hi' },
    { kind: 'heartbeats', at: '2026-01-01T00:00:04Z', count: 1 },
    { kind: 'event', at: '2026-01-01T00:00:05Z', text: 'completed: Done' },
  ]);
});

test('running tasks refresh fastest and closed tasks stop refreshing', () => {
  assert.equal(activityPollMs('running'), 3000);
  assert.equal(activityPollMs('blocked'), 10000);
  assert.equal(activityPollMs('done'), null);
});

test('each finished run shows in the thread in order, and its summary is not repeated as an event', () => {
  const run = (id: number, endedAt: string | null, summary: string, status = 'review') => ({ id, profile: 'explorer', status, outcome: 'review_requested', startedAt: '2026-01-01T00:00:00Z', endedAt, summary });
  const entries = threadEntries({
    comments: [{ author: 'user', body: 'Concisely, please', at: '2026-01-01T00:00:05Z' }],
    events: [event('review_requested', '2026-01-01T00:00:04Z', 'Long answer'), event('review_requested', '2026-01-01T00:00:09Z', 'Short answer')],
    runs: [run(1, '2026-01-01T00:00:04Z', 'Long answer'), run(2, '2026-01-01T00:00:09Z', 'Short answer'), run(3, null, '', 'running')],
  });
  assert.deepEqual(entries.map(e => e.kind === 'run' ? `run ${e.run.summary}` : e.kind === 'comment' ? `comment ${e.body}` : e.kind), ['run Long answer', 'comment Concisely, please', 'run Short answer']);
});
