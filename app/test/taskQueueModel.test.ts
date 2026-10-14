import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardTask } from '../src/api.ts';
import { filterByStatus, groupTasks, needsYou, projectName, toggleStatusFilter } from '../src/taskQueueModel.ts';

function task(number: number, fields: Partial<BoardTask> = {}): BoardTask {
  return { id: `t_${number}`, number, ref: `ORT-${number}`, title: `Task ${number}`, body: '', status: 'todo', assignee: null, createdBy: null, createdAt: null, startedAt: null, completedAt: null, lastError: null, ...fields };
}

test('groupTasks orders status groups by the board workflow and puts unassigned last', () => {
  const tasks = [task(3, { status: 'done', assignee: 'builder' }), task(1), task(2, { status: 'running', assignee: 'builder' })];
  assert.deepEqual(groupTasks(tasks, 'status').map(g => g.label), ['Todo', 'Running', 'Done']);
  assert.deepEqual(groupTasks(tasks, 'assignee').map(g => [g.label, g.tasks.map(t => t.ref)]), [['builder', ['ORT-2', 'ORT-3']], ['Unassigned', ['ORT-1']]]);
});

test('status filter hides archived by default and collapses to all when every status is picked', () => {
  const tasks = [task(1), task(2, { status: 'archived' })];
  assert.deepEqual(filterByStatus(tasks, []).map(t => t.ref), ['ORT-1']);
  assert.deepEqual(filterByStatus(tasks, ['archived']).map(t => t.ref), ['ORT-2']);
  let filter = toggleStatusFilter([], 'triage');
  for (const s of ['todo', 'ready', 'running', 'blocked', 'review', 'done', 'archived'] as const) filter = toggleStatusFilter(filter, s);
  assert.deepEqual(filter, []);
});

test('needsYou lists review and blocked tasks only', () => {
  const tasks = [task(1, { status: 'review' }), task(2, { status: 'running' }), task(3, { status: 'blocked' })];
  assert.deepEqual(needsYou(tasks).map(t => t.ref), ['ORT-1', 'ORT-3']);
});

test('tasks group by project and old project-less tasks show as Unassigned', () => {
  const projects = [{ id: 'project_site', name: 'Site' }, { id: 'project_general', name: 'General' }];
  const tasks = [task(1), task(2, { projectId: 'project_site' }), task(3, { projectId: 'project_general' }), task(4, { projectId: 'project_gone' })];
  assert.deepEqual(groupTasks(tasks, 'project', projects).map(g => [g.label, g.tasks.map(t => t.ref)]), [['General', ['ORT-3']], ['Site', ['ORT-2']], ['Unassigned', ['ORT-1', 'ORT-4']]]);
  assert.equal(projectName(tasks[1], projects), 'Site');
  assert.equal(projectName(tasks[0], projects), null);
});
