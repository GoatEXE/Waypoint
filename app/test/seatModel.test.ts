import test from 'node:test';
import assert from 'node:assert/strict';
import { seatWork } from '../src/seatModel.ts';
import type { BoardTask } from '../src/api.ts';

const task = (id: string, status: BoardTask['status'], assignee: string | null, at: string): BoardTask => ({
  id, board: 'default', number: Number(id.slice(2)), ref: `W-${id.slice(2)}`, title: id, body: '', status, assignee, createdBy: 'user', createdAt: at, startedAt: null, completedAt: null, lastError: null,
});

test('a seat is working when it has a running task, even with others queued', () => {
  const board = [task('t_1', 'done', 'dev', '2026-01-01'), task('t_2', 'ready', 'dev', '2026-01-02'), task('t_3', 'running', 'dev', '2026-01-03'), task('t_4', 'running', 'qa', '2026-01-04')];
  const work = seatWork('dev', board);
  assert.equal(work.state, 'running');
  assert.equal(work.current?.id, 't_3');
  assert.deepEqual(work.recent.map(t => t.id), ['t_3', 't_2', 't_1']);
});

test('blocked beats review beats queued, and no open work is idle', () => {
  assert.equal(seatWork('dev', [task('t_1', 'review', 'dev', '2026-01-01'), task('t_2', 'blocked', 'dev', '2026-01-02')]).state, 'blocked');
  assert.equal(seatWork('dev', [task('t_1', 'review', 'dev', '2026-01-01'), task('t_2', 'todo', 'dev', '2026-01-02')]).state, 'review');
  const idle = seatWork('dev', [task('t_1', 'done', 'dev', '2026-01-01'), task('t_2', 'archived', 'dev', '2026-01-02')]);
  assert.equal(idle.state, 'idle');
  assert.equal(idle.current, null);
  assert.deepEqual(idle.recent.map(t => t.id), ['t_1']);
});
