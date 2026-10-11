import test from 'node:test';
import assert from 'node:assert/strict';
import { missionProjects, projectTasks, statusCounts } from '../src/projectProgress.ts';
import type { BoardTask, Project } from '../src/api.ts';

const task = (id: string, status: BoardTask['status'], projectId: string | null, number: number): BoardTask => ({
  id, board: 'default', number, ref: `W-${number}`, title: id, body: '', status, assignee: null, createdBy: 'user', createdAt: null, startedAt: null, completedAt: null, lastError: null, projectId,
});

test('project tasks are filtered by project and counted by status', () => {
  const board = [task('a', 'done', 'p1', 1), task('b', 'running', 'p1', 2), task('c', 'running', 'p2', 3), task('d', 'archived', 'p1', 4), task('e', 'todo', null, 5)];
  assert.deepEqual(projectTasks(board, ['p1']).map(t => t.id), ['b', 'a']);
  assert.deepEqual(statusCounts(projectTasks(board, ['p1', 'p2'])), [{ status: 'running', count: 2 }, { status: 'done', count: 1 }]);
});

const project = (id: string, missionId: string | null): Project => ({ id, name: id, missionId, repo: null, createdAt: '', updatedAt: '' });

test('mission page lists only projects linked to the mission', () => {
  const projects = [project('p1', 'm1'), project('p2', 'm2'), project('p3', 'm1'), project('p4', null)];
  assert.deepEqual(missionProjects(projects, 'm1').map(p => p.id), ['p1', 'p3']);
  assert.deepEqual(missionProjects(projects, 'm3'), []);
});
