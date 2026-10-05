import * as D from './data';
import type { InboxItem, Project, ProjectId, Status, Task, TaskStatus, Seat, SeatStatus } from './data';

export const ACC = 'oklch(0.72 0.14 252)';

export interface StatusStyle { l: string; bg: string; bd: string; c: string }
const ST: Record<Status, StatusStyle> = {
  done: { l: 'Done', bg: '#9a9ea6', bd: '#9a9ea6', c: '#8a8e97' },
  running: { l: 'Running', bg: ACC, bd: ACC, c: '#c9ccd2' },
  review: { l: 'In review', bg: 'transparent', bd: ACC, c: '#c9ccd2' },
  blocked: { l: 'Blocked', bg: 'transparent', bd: '#e6e7ea', c: '#e6e7ea' },
  queued: { l: 'Queued', bg: 'transparent', bd: '#4a4e56', c: '#6b6f78' },
  decision: { l: 'Needs decision', bg: 'transparent', bd: ACC, c: 'oklch(0.8 0.12 252)' },
  passed: { l: 'Passed', bg: ACC, bd: ACC, c: '#c9ccd2' },
  failed: { l: 'Failed', bg: 'transparent', bd: '#e6e7ea', c: '#e6e7ea' },
  superseded: { l: 'Superseded', bg: 'transparent', bd: '#4a4e56', c: '#6b6f78' },
  stopped: { l: 'Stopped', bg: 'transparent', bd: '#4a4e56', c: '#6b6f78' },
};
export const st = (k: Status): StatusStyle => ST[k] ?? ST.queued;

export type Resolved = Record<string, 'yes' | 'no'>;

export const projById = (id: ProjectId): Project => D.projects.find(p => p.id === id)!;
export const projIdByName = (name: string) => D.projects.find(p => p.name === name)?.id;

/** Task statuses after the user's approvals and decisions are applied. */
export function liveTasks(resolved: Resolved): Task[] {
  return D.tasks.map(t => {
    let s: TaskStatus = t.st;
    if (t.id === 'WP-138' && resolved['merge-138'] === 'yes') s = 'done';
    if (t.id === 'WP-210' && resolved['secret-ch'] === 'yes') s = 'running';
    if (t.id === 'WP-301' && resolved['consent']) s = 'running';
    return { ...t, st: s };
  });
}

export function seatStatus(s: Seat, resolved: Resolved, podStopped: boolean): SeatStatus {
  if (podStopped && s.pod === 'web-squad-01') return 'stopped';
  if (s.name === 'backend-2' && resolved['secret-ch'] === 'yes') return 'running';
  return s.st;
}

export function projStats(p: Project, tasks: Task[]) {
  const ts = tasks.filter(t => t.p === p.id);
  const n = (k: TaskStatus) => ts.filter(t => t.st === k).length;
  const done = n('done'), running = n('running'), blocked = n('blocked'), dec = n('decision');
  const pct = Math.round(((done + running * 0.45 + n('review') * 0.8) / ts.length) * 100);
  const flag = [running ? running + ' running' : null, blocked ? blocked + ' blocked' : null, dec ? dec + ' needs decision' : null].filter(Boolean).join(' · ');
  return { ts, done, total: ts.length, pct, flag };
}

export function missionPct(tasks: Task[]) {
  return Math.round(D.projects.reduce((a, p) => a + projStats(p, tasks).pct, 0) / D.projects.length);
}

export const pendingInbox = (resolved: Resolved) => D.inbox.filter(i => !resolved[i.id]);

export const inboxParent = (i: InboxItem): ProjectId | undefined =>
  i.task ? D.tasks.find(t => t.id === i.task)?.p : i.id === 'learn-web' ? 'web' : undefined;

export interface Group<T> { key: string; label: string; sub: string; to: string; items: T[] }

/** Groups items under their project, with mission-level items first. Empty groups are dropped. */
export function byParent<T>(items: T[], parentOf: (x: T) => ProjectId | undefined): Group<T>[] {
  const order: (ProjectId | 'mission')[] = ['mission', 'web', 'api', 'cmp'];
  return order
    .map(pid => {
      const its = items.filter(x => (parentOf(x) ?? 'mission') === pid);
      if (pid === 'mission') return { key: pid, label: D.mission.short, sub: 'Mission', to: '/', items: its };
      const p = projById(pid);
      return { key: pid, label: p.name, sub: p.goal, to: `/projects/${pid}`, items: its };
    })
    .filter(g => g.items.length);
}

export function trailFor(t: Task) {
  return t.trail ?? [
    { from: 'you', verb: 'assigned mission to', to: 'ceo', when: 'Oct 2', text: 'Launch v2 of the patient intake app.' },
    { from: 'ceo', verb: 'delegated to', to: t.owner, when: 'Oct 3', text: t.title + '.' },
  ];
}

export const clock = () => { const d = new Date(); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
