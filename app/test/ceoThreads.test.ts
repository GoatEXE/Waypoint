import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteThreadCopy, isTaskThread, paneCeoList, paneTaskView, talkedTaskThreads, threadAge, threadMeta, visibleTaskThreads } from '../src/ceoThreads.ts';

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
  assert.equal(threadMeta({ ...base, status: 'review', messageCount: 20, updatedAt: '2026-10-08T11:37:00Z' }, now), 'review · 23m ago · 20 msgs');
  assert.equal(threadMeta({ ...base, status: null, messageCount: 1, updatedAt: null }, now), '1 msg');
  assert.equal(threadMeta({ ...base, status: 'todo', messageCount: 0, updatedAt: null }, now), 'todo · no messages');
});

test('visibleTaskThreads keeps the most recent open tasks unless showing all', () => {
  const task = (n: number, status: 'todo' | 'done' | 'archived' = 'todo') => ({ threadId: `t_${n}`, title: `T${n}`, ref: null, status, messageCount: 0, updatedAt: null, lastText: '' });
  const tasks = [task(0, 'done'), task(1, 'archived'), ...Array.from({ length: 12 }, (_, i) => task(i + 2))];
  const limited = visibleTaskThreads(tasks, false);
  assert.deepEqual(limited.shown.map(t => t.threadId), Array.from({ length: 10 }, (_, i) => `t_${i + 2}`));
  assert.equal(limited.hidden, 4);
  assert.deepEqual(visibleTaskThreads(tasks, true), { shown: tasks, hidden: 0 });
});

test('talkedTaskThreads lists task threads with CEO messages, newest first', () => {
  const thread = (id: string, messageCount: number, updatedAt: string | null) => ({ threadId: id, title: id, ref: null, status: 'todo' as const, messageCount, updatedAt, lastText: '' });
  const threads = [
    thread('general', 5, '2026-10-08T11:59:00Z'),
    thread('t_aaaaaa', 2, '2026-10-08T09:00:00Z'),
    thread('t_bbbbbb', 0, '2026-10-08T11:00:00Z'),
    thread('t_cccccc', 4, '2026-10-08T10:00:00Z'),
    thread('t_dddddd', 1, null),
  ];
  assert.deepEqual(talkedTaskThreads(threads).map(t => t.threadId), ['t_cccccc', 't_aaaaaa', 't_dddddd']);
});

test('only board task ids open task threads', () => {
  assert.equal(isTaskThread('t_1a2b3c4d'), true);
  assert.equal(isTaskThread('general'), false);
  assert.equal(isTaskThread('task_00000000-0000-4000-8000-000000000001'), false);
});

test('a task opened in the side panel shows its conversation unless the CEO chat was chosen', () => {
  assert.equal(paneTaskView(undefined), 'thread');
  assert.equal(paneTaskView('bogus'), 'thread');
  assert.equal(paneTaskView('thread'), 'thread');
  assert.equal(paneTaskView('ceo'), 'ceo');
});

test('the CEO pane opens on the chat unless the thread list was left open', () => {
  assert.equal(paneCeoList(undefined), false);
  assert.equal(paneCeoList('yes'), false);
  assert.equal(paneCeoList(true), true);
});

test('deleting a thread says the task stays', () => {
  const copy = deleteThreadCopy('SUN-3 · Fix it', 'Ava');
  assert.equal(copy.title, 'Delete the SUN-3 · Fix it thread?');
  assert.match(copy.body, /Ava/);
  assert.match(copy.body, /task itself stays/);
});
