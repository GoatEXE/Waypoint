import test from 'node:test';
import assert from 'node:assert/strict';
import type { TaskSummary } from '../src/api.ts';
import { groupTasks, isBlocked, ownerLabel, parseLabels, relations, statusOptions } from '../src/taskQueueModel.ts';

function task(number: number, fields: Partial<TaskSummary> = {}): TaskSummary {
  return { id: `task_${number}`, number, ref: `ORT-${number}`, summary: `Task ${number}`, description: '', status: 'todo', state: 'delegated', podId: null, seatId: null, projectId: null, labels: [], parentId: null, blockedBy: [], createdAt: '', updatedAt: '', ...fields };
}

const pods = [{ podId: 'pod_1', name: 'web-squad', seats: [{ seatId: 'lead', role: 'Lead' }] }];
const projects = [{ id: 'project_1', name: 'Website', createdAt: '', updatedAt: '' }];

test('groupTasks orders status groups by workflow and skips empty ones', () => {
  const groups = groupTasks([task(2, { status: 'done' }), task(1), task(3)], 'status', { projects, pods });
  assert.deepEqual(groups.map(g => g.label), ['Todo', 'Done']);
  assert.deepEqual(groups[0].tasks.map(t => t.ref), ['ORT-1', 'ORT-3']);
});

test('groupTasks puts unassigned groups last for project, owner, and parent', () => {
  const tasks = [task(1), task(2, { projectId: 'project_1', podId: 'pod_1', seatId: 'lead', parentId: 'task_1' })];
  assert.deepEqual(groupTasks(tasks, 'project', { projects, pods }).map(g => g.label), ['Website', 'No project']);
  assert.deepEqual(groupTasks(tasks, 'owner', { projects, pods }).map(g => g.label), ['web-squad / lead', 'Unassigned']);
  assert.deepEqual(groupTasks(tasks, 'parent', { projects, pods }).map(g => g.label), ['ORT-1 Task 1', 'No parent']);
});

test('relations derive subtasks and blocking from the other tasks', () => {
  const parent = task(1);
  const child = task(2, { parentId: 'task_1', blockedBy: ['task_3'] });
  const blocker = task(3);
  const all = [parent, child, blocker];
  assert.deepEqual(relations(parent, all).subtasks.map(t => t.ref), ['ORT-2']);
  assert.deepEqual(relations(blocker, all).blocking.map(t => t.ref), ['ORT-2']);
  assert.equal(isBlocked(child, all), true);
  assert.equal(isBlocked(child, [parent, child, { ...blocker, status: 'done' }]), false);
});

test('ownerLabel and parseLabels format inputs', () => {
  assert.equal(ownerLabel({ podId: 'pod_1', seatId: null }, pods), 'web-squad');
  assert.equal(ownerLabel({ podId: null, seatId: null }, pods), 'Unassigned');
  assert.deepEqual(parseLabels('Front End, urgent, , urgent'), ['front-end', 'urgent']);
});

test('statusOptions offers the current status plus allowed transitions, and only the current one while running', () => {
  assert.deepEqual(statusOptions('done'), ['todo', 'in_review', 'done']);
  assert.deepEqual(statusOptions('canceled'), ['backlog', 'todo', 'canceled']);
  assert.deepEqual(statusOptions('in_progress', true), ['in_progress']);
  assert.equal(statusOptions(undefined).length, 6);
});
