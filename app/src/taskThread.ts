import type { BoardTaskDetail } from './api';

export type ThreadEntry =
  | { kind: 'comment'; at: string; author: string; body: string }
  | { kind: 'event'; at: string; text: string }
  | { kind: 'heartbeats'; at: string; count: number };

function eventText(kind: string, detail: string): string {
  const text = kind.replaceAll('_', ' ');
  return detail ? `${text}: ${detail}` : text;
}

export function threadEntries(task: Pick<BoardTaskDetail, 'comments' | 'events'>): ThreadEntry[] {
  const entries: ThreadEntry[] = [
    ...task.comments.map(c => ({ kind: 'comment' as const, at: c.at || '', author: c.author, body: c.body })),
    ...task.events.filter(e => e.kind !== 'commented').map(e => e.kind === 'heartbeat'
      ? { kind: 'heartbeats' as const, at: e.at || '', count: 1 }
      : { kind: 'event' as const, at: e.at || '', text: eventText(e.kind, e.detail) }),
  ];
  const sorted = entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at.localeCompare(b.entry.at) || a.index - b.index)
    .map(({ entry }) => entry);
  const out: ThreadEntry[] = [];
  for (const entry of sorted) {
    const last = out.at(-1);
    if (entry.kind === 'heartbeats' && last?.kind === 'heartbeats') out[out.length - 1] = { kind: 'heartbeats', at: entry.at, count: last.count + 1 };
    else out.push(entry);
  }
  return out;
}

export function activityPollMs(status: string): number | null {
  if (status === 'running') return 3000;
  if (status === 'done' || status === 'archived') return null;
  return 10000;
}
