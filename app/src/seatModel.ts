import type { BoardTask } from './api';

export type SeatState = 'running' | 'blocked' | 'review' | 'queued' | 'idle';

const ORDER: [SeatState, BoardTask['status'][]][] = [
  ['running', ['running']],
  ['blocked', ['blocked']],
  ['review', ['review']],
  ['queued', ['ready', 'todo', 'triage']],
];

export const SEAT_STATE_LABEL: Record<SeatState, string> = { running: 'Working', blocked: 'Blocked', review: 'In review', queued: 'Queued', idle: 'Idle' };

function latest(task: BoardTask) {
  return task.completedAt || task.startedAt || task.createdAt || '';
}

export function seatWork(seatId: string, board: BoardTask[], recentLimit = 8) {
  const mine = board.filter(t => t.assignee === seatId && t.status !== 'archived');
  for (const [state, statuses] of ORDER) {
    const current = mine.filter(t => statuses.includes(t.status)).sort((a, b) => latest(b).localeCompare(latest(a)))[0];
    if (current) return { state, current, recent: recentTasks(mine, recentLimit) };
  }
  return { state: 'idle' as SeatState, current: null, recent: recentTasks(mine, recentLimit) };
}

function recentTasks(tasks: BoardTask[], limit: number) {
  return [...tasks].sort((a, b) => latest(b).localeCompare(latest(a)) || (b.number ?? 0) - (a.number ?? 0)).slice(0, limit);
}
