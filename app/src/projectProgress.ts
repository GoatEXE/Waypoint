import type { BoardStatus, BoardTask } from './api';

export function statusCounts(tasks: BoardTask[]): { status: BoardStatus; count: number }[] {
  const order: BoardStatus[] = ['running', 'blocked', 'review', 'ready', 'todo', 'triage', 'done'];
  return order.map(status => ({ status, count: tasks.filter(t => t.status === status).length })).filter(c => c.count);
}

export function projectTasks(board: BoardTask[], projectIds: string[]): BoardTask[] {
  const ids = new Set(projectIds);
  return board.filter(t => t.projectId && ids.has(t.projectId) && t.status !== 'archived').sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
}
