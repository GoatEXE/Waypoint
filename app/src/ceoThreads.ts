import type { CeoThread } from './api';

export function threadAge(updatedAt: string | null, now = Date.now()) {
  if (!updatedAt) return '';
  const time = new Date(updatedAt).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function threadMeta(thread: CeoThread, now = Date.now()) {
  const parts = [thread.status ? thread.status.replaceAll('_', ' ') : '', threadAge(thread.updatedAt, now), thread.messageCount ? `${thread.messageCount} msg${thread.messageCount === 1 ? '' : 's'}` : 'no messages'];
  return parts.filter(Boolean).join(' · ');
}

export const THREAD_LIST_LIMIT = 10;
const CLOSED = new Set(['done', 'archived']);

export const isTaskThread = (threadId: string) => /^t_[0-9a-f]{6,32}$/.test(threadId);

export function visibleTaskThreads(tasks: CeoThread[], showAll: boolean) {
  const shown = showAll ? tasks : tasks.filter(t => !CLOSED.has(t.status || '')).slice(0, THREAD_LIST_LIMIT);
  return { shown, hidden: tasks.length - shown.length };
}
