import type { Project, TaskStatus, TaskSummary } from './api';

export const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'Todo' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
  { id: 'canceled', label: 'Canceled' },
];

export const STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['todo', 'in_progress', 'in_review', 'done', 'canceled'],
  todo: ['backlog', 'in_progress', 'in_review', 'done', 'canceled'],
  in_progress: ['todo', 'in_review', 'done', 'canceled'],
  in_review: ['todo', 'in_progress', 'done', 'canceled'],
  done: ['todo', 'in_review'],
  canceled: ['backlog', 'todo'],
};

export function statusOptions(from: TaskStatus | undefined, locked = false): TaskStatus[] {
  if (!from) return STATUSES.map(s => s.id);
  if (locked) return [from];
  return STATUSES.map(s => s.id).filter(id => id === from || STATUS_TRANSITIONS[from].includes(id));
}

export type GroupBy = 'status' | 'project' | 'parent' | 'owner';
export const GROUP_BY: { id: GroupBy; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'project', label: 'Project' },
  { id: 'parent', label: 'Parent task' },
  { id: 'owner', label: 'Owner' },
];

export interface OrgPod { podId: string; name: string; seats: { seatId: string; role: string }[] }
export interface QueueContext { projects: Project[]; pods: OrgPod[] }
export interface TaskGroup { key: string; label: string; tasks: TaskSummary[] }

export function statusLabel(status: TaskStatus): string {
  return STATUSES.find(s => s.id === status)?.label || status;
}

export function taskLabel(task: Pick<TaskSummary, 'ref' | 'id'>): string {
  return task.ref || task.id.slice(0, 13);
}

export function ownerLabel(task: Pick<TaskSummary, 'podId' | 'seatId'>, pods: OrgPod[]): string {
  if (!task.podId) return 'Unassigned';
  const pod = pods.find(p => p.podId === task.podId);
  const podName = pod?.name || task.podId.slice(0, 12);
  return task.seatId ? `${podName} / ${task.seatId}` : podName;
}

function byNumber(a: TaskSummary, b: TaskSummary) {
  return (a.number ?? Infinity) - (b.number ?? Infinity) || a.id.localeCompare(b.id);
}

export function groupTasks(tasks: TaskSummary[], by: GroupBy, ctx: QueueContext): TaskGroup[] {
  const sorted = [...tasks].sort(byNumber);
  if (by === 'status') return STATUSES.map(s => ({ key: s.id, label: s.label, tasks: sorted.filter(t => t.status === s.id) })).filter(g => g.tasks.length);
  const groups = new Map<string, TaskGroup>();
  const add = (key: string, label: string, task: TaskSummary) => {
    if (!groups.has(key)) groups.set(key, { key, label, tasks: [] });
    groups.get(key)!.tasks.push(task);
  };
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const task of sorted) {
    if (by === 'project') add(task.projectId || '', ctx.projects.find(p => p.id === task.projectId)?.name || 'No project', task);
    else if (by === 'owner') add(task.podId ? `${task.podId}/${task.seatId || ''}` : '', ownerLabel(task, ctx.pods), task);
    else {
      const parent = task.parentId ? byId.get(task.parentId) : undefined;
      add(task.parentId || '', parent ? `${taskLabel(parent)} ${parent.summary}` : 'No parent', task);
    }
  }
  return [...groups.values()].sort((a, b) => Number(!a.key) - Number(!b.key) || a.label.localeCompare(b.label));
}

export function relations(task: TaskSummary, tasks: TaskSummary[]) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  return {
    parent: task.parentId ? byId.get(task.parentId) || null : null,
    subtasks: tasks.filter(t => t.parentId === task.id).sort(byNumber),
    blockedBy: task.blockedBy.map(id => byId.get(id)).filter((t): t is TaskSummary => Boolean(t)),
    blocking: tasks.filter(t => t.blockedBy.includes(task.id)).sort(byNumber),
  };
}

export function isBlocked(task: TaskSummary, tasks: TaskSummary[]): boolean {
  return relations(task, tasks).blockedBy.some(t => t.status !== 'done' && t.status !== 'canceled');
}

export function parseLabels(text: string): string[] {
  return [...new Set(text.split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))];
}
