import type { BoardTaskDetail, TaskRun } from './api';

export type ThreadEntry =
  | { kind: 'comment'; at: string; author: string; body: string }
  | { kind: 'event'; at: string; text: string }
  | { kind: 'heartbeats'; at: string; count: number }
  | { kind: 'run'; at: string; run: TaskRun; index: number };

function eventText(kind: string, detail: string): string {
  const text = kind.replaceAll('_', ' ');
  return detail ? `${text}: ${detail}` : text;
}

export function threadEntries(task: Pick<BoardTaskDetail, 'comments' | 'events' | 'runs'>): ThreadEntry[] {
  const runs = task.runs || [];
  const summaries = new Set(runs.map(r => r.summary.trim()).filter(Boolean));
  const entries: ThreadEntry[] = [
    ...runs.map((run, index) => ({ run, index })).filter(({ run }) => run.status !== 'running' && (run.endedAt || run.startedAt))
      .map(({ run, index }) => ({ kind: 'run' as const, at: run.endedAt || run.startedAt || '', run, index })),
    ...task.comments.map(c => ({ kind: 'comment' as const, at: c.at || '', author: c.author, body: c.body })),
    ...task.events.filter(e => e.kind !== 'commented' && !(runs.length && e.kind === 'review_requested') && !(e.detail && summaries.has(e.detail.trim()))).map(e => e.kind === 'heartbeat'
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

export type ThreadBlock = Exclude<ThreadEntry, { kind: 'event' } | { kind: 'heartbeats' }> | { kind: 'updates'; at: string; entries: Extract<ThreadEntry, { kind: 'event' } | { kind: 'heartbeats' }>[] };

export function groupUpdates(entries: ThreadEntry[]): ThreadBlock[] {
  const out: ThreadBlock[] = [];
  for (const entry of entries) {
    if (entry.kind === 'event' || entry.kind === 'heartbeats') {
      const last = out.at(-1);
      if (last?.kind === 'updates') { last.entries.push(entry); last.at = entry.at; }
      else out.push({ kind: 'updates', at: entry.at, entries: [entry] });
    } else out.push(entry);
  }
  return out;
}

export function isUserAuthor(author: string | null | undefined) {
  return !author || author === 'user';
}
