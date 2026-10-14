import type { BoardStatus, BoardTask, Project } from './api';

export const STATUSES: { id: BoardStatus; label: string }[] = [
  { id: 'triage', label: 'Triage' },
  { id: 'todo', label: 'Todo' },
  { id: 'ready', label: 'Ready' },
  { id: 'running', label: 'Running' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'review', label: 'In review' },
  { id: 'done', label: 'Done' },
  { id: 'archived', label: 'Archived' },
];

export type GroupBy = 'status' | 'assignee' | 'project';
export const GROUP_BY: { id: GroupBy; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'project', label: 'Project' },
];

export const NO_PROJECT = 'Unassigned';

export function projectName(task: Pick<BoardTask, 'projectId'>, projects: Pick<Project, 'id' | 'name'>[]): string | null {
  return projects.find(p => p.id === task.projectId)?.name || null;
}

export interface TaskGroup { key: string; label: string; tasks: BoardTask[] }

export function statusLabel(status: BoardStatus): string {
  return STATUSES.find(s => s.id === status)?.label || status;
}

export function taskLabel(task: Pick<BoardTask, 'ref' | 'id'>): string {
  return task.ref || task.id;
}

function byNumber(a: BoardTask, b: BoardTask) {
  return (a.number ?? Infinity) - (b.number ?? Infinity) || a.id.localeCompare(b.id);
}

export function needsYou(tasks: BoardTask[]): BoardTask[] {
  return tasks.filter(t => t.status === 'review' || t.status === 'blocked').sort(byNumber);
}

export function savedStatusFilter(value: unknown): BoardStatus[] {
  if (!Array.isArray(value)) return [];
  return STATUSES.map(s => s.id).filter(id => value.includes(id));
}

export function toggleStatusFilter(filter: BoardStatus[], status: BoardStatus): BoardStatus[] {
  const next = filter.includes(status) ? filter.filter(s => s !== status) : [...filter, status];
  return next.length === STATUSES.length ? [] : STATUSES.map(s => s.id).filter(id => next.includes(id));
}

export function filterByStatus(tasks: BoardTask[], filter: BoardStatus[]): BoardTask[] {
  return filter.length ? tasks.filter(t => filter.includes(t.status)) : tasks.filter(t => t.status !== 'archived');
}

export function groupTasks(tasks: BoardTask[], by: GroupBy, projects: Pick<Project, 'id' | 'name'>[] = []): TaskGroup[] {
  const sorted = [...tasks].sort(byNumber);
  if (by === 'status') return STATUSES.map(s => ({ key: s.id, label: s.label, tasks: sorted.filter(t => t.status === s.id) })).filter(g => g.tasks.length);
  const groups = new Map<string, TaskGroup>();
  for (const task of sorted) {
    const name = by === 'project' ? projectName(task, projects) : task.assignee;
    const key = name ? (by === 'project' ? task.projectId! : name) : '';
    if (!groups.has(key)) groups.set(key, { key, label: name || (by === 'project' ? NO_PROJECT : 'Unassigned'), tasks: [] });
    groups.get(key)!.tasks.push(task);
  }
  return [...groups.values()].sort((a, b) => Number(!a.key) - Number(!b.key) || a.label.localeCompare(b.label));
}
