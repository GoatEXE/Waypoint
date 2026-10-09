import test from 'node:test';
import assert from 'node:assert/strict';
import { threadAge, threadMeta, visibleTaskThreads } from '../src/ceoThreads.ts';

const now = Date.parse('2026-10-08T12:00:00Z');

test('threadAge renders compact relative times', () => {
  assert.equal(threadAge(null, now), '');
  assert.equal(threadAge('not a date', now), '');
  assert.equal(threadAge('2026-10-08T11:59:40Z', now), 'just now');
  assert.equal(threadAge('2026-10-08T11:37:00Z', now), '23m ago');
  assert.equal(threadAge('2026-10-08T09:00:00Z', now), '3h ago');
  assert.equal(threadAge('2026-10-06T12:00:00Z', now), '2d ago');
});

test('threadMeta joins status, age, and message count', () => {
  const base = { threadId: 'task_x', title: 'Fix it', ref: 'ORT-1', lastText: '' };
  assert.equal(threadMeta({ ...base, status: 'in_review', messageCount: 20, updatedAt: '2026-10-08T11:37:00Z' }, now), 'in review · 23m ago · 20 msgs');
  assert.equal(threadMeta({ ...base, status: null, messageCount: 1, updatedAt: null }, now), '1 msg');
  assert.equal(threadMeta({ ...base, status: 'todo', messageCount: 0, updatedAt: null }, now), 'todo · no messages');
});

test('visibleTaskThreads keeps the most recent open tasks unless showing all', () => {
  const task = (n: number, status: 'todo' | 'done' | 'canceled' = 'todo') => ({ threadId: `task_${n}`, title: `T${n}`, ref: null, status, messageCount: 0, updatedAt: null, lastText: '' });
  const tasks = [task(0, 'done'), task(1, 'canceled'), ...Array.from({ length: 12 }, (_, i) => task(i + 2))];
  const limited = visibleTaskThreads(tasks, false);
  assert.deepEqual(limited.shown.map(t => t.threadId), Array.from({ length: 10 }, (_, i) => `task_${i + 2}`));
  assert.equal(limited.hidden, 4);
  assert.deepEqual(visibleTaskThreads(tasks, true), { shown: tasks, hidden: 0 });
});
