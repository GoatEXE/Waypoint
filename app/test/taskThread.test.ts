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
