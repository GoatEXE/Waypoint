import * as D from './data';
import type { InboxItem, Project, ProjectId, Status, Task, TaskStatus, Seat, SeatStatus, TrailStep } from './data';

export const ACC = 'var(--acc)';

export interface StatusStyle { l: string; bg: string; bd: string; c: string }
const ST: Record<Status, StatusStyle> = {
  done: { l: 'Done', bg: 'var(--muted)', bd: 'var(--muted)', c: 'var(--muted)' },
  running: { l: 'Running', bg: ACC, bd: ACC, c: 'var(--text-3)' },
  review: { l: 'In review', bg: 'transparent', bd: ACC, c: 'var(--text-3)' },
  blocked: { l: 'Blocked', bg: 'transparent', bd: 'var(--text)', c: 'var(--text)' },
  queued: { l: 'Queued', bg: 'transparent', bd: 'var(--quiet)', c: 'var(--faint)' },
  decision: { l: 'Needs decision', bg: 'transparent', bd: ACC, c: 'var(--acc-text)' },
  passed: { l: 'Passed', bg: ACC, bd: ACC, c: 'var(--text-3)' },
  failed: { l: 'Failed', bg: 'transparent', bd: 'var(--text)', c: 'var(--text)' },
  superseded: { l: 'Superseded', bg: 'transparent', bd: 'var(--quiet)', c: 'var(--faint)' },
  stopped: { l: 'Stopped', bg: 'transparent', bd: 'var(--quiet)', c: 'var(--faint)' },
};
export const st = (k: Status): StatusStyle => ST[k] ?? ST.queued;

export type Resolved = Record<string, 'yes' | 'no'>;

export const projById = (id: ProjectId): Project | undefined => D.projects.find(p => p.id === id);
export const projIdByName = (name: string) => D.projects.find(p => p.name === name)?.id;

export function liveTasks(_resolved: Resolved): Task[] {
  return D.tasks;
}

export function seatStatus(s: Seat, _resolved: Resolved, podStopped: boolean): SeatStatus {
  if (podStopped && s.pod && D.pods.some(p => p.name === s.pod)) return 'stopped';
  return s.st;
}

export function projStats(p: Project, tasks: Task[]) {
  const ts = tasks.filter(t => t.p === p.id);
  const n = (k: TaskStatus) => ts.filter(t => t.st === k).length;
  const done = n('done'), running = n('running'), blocked = n('blocked'), dec = n('decision'), review = n('review');
  const pct = ts.length ? Math.round(((done + running * 0.45 + review * 0.8) / ts.length) * 100) : 0;
  const flag = [running ? running + ' running' : null, blocked ? blocked + ' blocked' : null, dec ? dec + ' needs decision' : null].filter(Boolean).join(' · ');
  return { ts, done, total: ts.length, pct, flag };
}

export function missionPct(tasks: Task[]) {
  if (!D.projects.length) return 0;
  return Math.round(D.projects.reduce((a, p) => a + projStats(p, tasks).pct, 0) / D.projects.length);
}

export const inboxParent = (i: InboxItem): ProjectId | undefined =>
  i.task ? D.tasks.find(t => t.id === i.task)?.p : undefined;

export interface Group<T> { key: string; label: string; sub: string; to: string; items: T[] }

export function byParent<T>(items: T[], parentOf: (x: T) => ProjectId | undefined): Group<T>[] {
  const grouped = new Map<ProjectId | 'mission', T[]>();
  for (const item of items) {
    const pid = parentOf(item);
    if (pid && !D.projects.some(p => p.id === pid)) continue;
    const key = pid ?? 'mission';
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  const order: (ProjectId | 'mission')[] = ['mission', ...D.projects.map(p => p.id)];
  return order.flatMap(pid => {
    const its = grouped.get(pid) || [];
    if (!its.length) return [];
    if (pid === 'mission') return [{ key: pid, label: D.mission?.short || 'Mission', sub: 'Mission', to: '/', items: its }];
    const p = projById(pid);
    return p ? [{ key: pid, label: p.name, sub: p.goal, to: `/projects/${pid}`, items: its }] : [];
  });
}

export function trailFor(t: Task): TrailStep[] {
  return t.trail ?? [];
}

export const clock = () => { const d = new Date(); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
