import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardTaskLink } from '../src/api.ts';
import { commentPlaceholder, confirmCopy, inboxPrimary, taskPrimary } from '../src/taskActionsModel.ts';

function link(ref: string, status: BoardTaskLink['status']): BoardTaskLink {
  return { id: `t_${ref}`, ref, title: ref, status, assignee: null };
}

test('blocked tasks make Reply and Unblock the primary action', () => {
  assert.equal(inboxPrimary('blocked'), 'reply');
  assert.equal(inboxPrimary('review'), 'approve');
  assert.equal(taskPrimary('blocked'), 'unblock');
  assert.equal(taskPrimary('running'), 'comment');
});

test('Mark done confirmation warns that a blocked seat gets no reply', () => {
  const copy = confirmCopy('complete', { ref: 'ORT-4', status: 'blocked', assignee: 'builder' });
  assert.equal(copy.title, 'Mark ORT-4 done?');
  assert.match(copy.body, /builder is waiting on your answer/);
  assert.match(confirmCopy('complete', { ref: 'ORT-4', status: 'running', assignee: null }).body, /the seat/);
});

test('Archive confirmation says waiting follow-ups are archived too', () => {
  const children = [link('ORT-5', 'todo'), link('ORT-6', 'done'), link('ORT-7', 'triage')];
  const copy = confirmCopy('archive', { ref: 'ORT-4', status: 'blocked', assignee: 'builder', children });
  assert.equal(copy.title, 'Archive ORT-4?');
  assert.match(copy.body, /2 waiting follow-ups \(ORT-5, ORT-7\) will be archived too/);
  assert.match(confirmCopy('archive', { ref: 'ORT-4', status: 'done', assignee: null, children: [link('ORT-5', 'todo')] }).body, /1 waiting follow-up \(ORT-5\)/);
  assert.match(confirmCopy('archive', { ref: 'ORT-4', status: 'done', assignee: null }).body, /follow-up tasks still waiting on it are archived too/);
});

test('comment placeholder says when the seat reads it', () => {
  assert.equal(commentPlaceholder('running', 'builder'), 'Comment — builder reads this when it next works on the task');
  assert.equal(commentPlaceholder('blocked', 'builder'), 'Reply — builder reads this when it next works on the task');
  assert.equal(commentPlaceholder('review', 'builder'), 'What needs to change?');
  assert.equal(commentPlaceholder('todo', null), 'Comment');
});
