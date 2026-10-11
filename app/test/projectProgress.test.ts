import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTasks, statusCounts } from '../src/projectProgress.ts';
import type { BoardTask } from '../src/api.ts';

const task = (id: string, status: BoardTask['status'], projectId: string | null, number: number): BoardTask => ({
  id, board: 'default', number, ref: `W-${number}`, title: id, body: '', status, assignee: null, createdBy: 'user', createdAt: null, startedAt: null, completedAt: null, lastError: null, projectId,
});

test('project tasks are filtered by project and counted by status', () => {
  const board = [task('a', 'done', 'p1', 1), task('b', 'running', 'p1', 2), task('c', 'running', 'p2', 3), task('d', 'archived', 'p1', 4), task('e', 'todo', null, 5)];
  assert.deepEqual(projectTasks(board, ['p1']).map(t => t.id), ['b', 'a']);
  assert.deepEqual(statusCounts(projectTasks(board, ['p1', 'p2'])), [{ status: 'running', count: 2 }, { status: 'done', count: 1 }]);
});
