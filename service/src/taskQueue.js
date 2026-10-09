import { badRequest, conflict } from './errors.js';

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
export const TASK_EDIT_FIELDS = ['summary', 'description', 'status', 'podId', 'seatId', 'projectId', 'labels', 'parentId', 'blockedBy'];
export const STATUS_TRANSITIONS = {
  backlog: ['todo', 'in_progress', 'in_review', 'done', 'canceled'],
  todo: ['backlog', 'in_progress', 'in_review', 'done', 'canceled'],
  in_progress: ['todo', 'in_review', 'done', 'canceled'],
  in_review: ['todo', 'in_progress', 'done', 'canceled'],
  done: ['todo', 'in_review'],
  canceled: ['backlog', 'todo'],
};
export const STATUS_ACTORS = ['user', 'ceo', 'seat', 'system'];
const STATUS_HISTORY_KEEP = 100;
const REOPEN_STATUSES = ['backlog', 'todo'];
export const TASK_REF_RE = /^([A-Z][A-Z0-9]{1,5})-([1-9][0-9]{0,8})$/;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 8000;
const LABELS_MAX = 10;
const LABEL_MAX = 32;
const BLOCKERS_MAX = 20;
const PROJECT_NAME_MAX = 80;

export function taskTitle(value) {
  if (typeof value !== 'string') throw badRequest('summary must be text');
  const text = value.trim();
  if (!text || text.length > TITLE_MAX || text.includes('\0')) throw badRequest(`summary must be 1-${TITLE_MAX} characters`);
  return text;
}

export function taskDescription(value) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > DESCRIPTION_MAX || value.includes('\0')) throw badRequest(`description must be at most ${DESCRIPTION_MAX} characters`);
  return value.trim();
}

export function taskStatus(value) {
  if (!TASK_STATUSES.includes(value)) throw badRequest(`status must be one of ${TASK_STATUSES.join(', ')}`);
  return value;
}

export function taskLabels(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > LABELS_MAX) throw badRequest(`labels must be a list of at most ${LABELS_MAX}`);
  const labels = [];
  for (const item of value) {
    const label = typeof item === 'string' ? item.trim().toLowerCase().replace(/\s+/g, '-') : '';
    if (!label || label.length > LABEL_MAX || /[\x00-\x1f\x7f,]/.test(label)) throw badRequest(`each label must be 1-${LABEL_MAX} characters without commas`);
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

export function taskBlockers(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > BLOCKERS_MAX) throw badRequest(`blockedBy must be a list of at most ${BLOCKERS_MAX} task ids`);
  return [...new Set(value.map((item) => String(item || '').trim()))];
}

export function projectName(value) {
  if (typeof value !== 'string') throw badRequest('project name must be text');
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > PROJECT_NAME_MAX || /[\x00-\x1f\x7f]/.test(text)) throw badRequest(`project name must be 1-${PROJECT_NAME_MAX} visible characters`);
  return text;
}

export function assertStatusTransition(from, to, state) {
  if (from === to) return;
  if (state === 'running') throw conflict('task status cannot change while a run is in progress', { status: from });
  if (!STATUS_TRANSITIONS[from]?.includes(to)) throw badRequest(`status cannot move from ${from} to ${to}; allowed: ${STATUS_TRANSITIONS[from]?.join(', ') || 'none'}`, { from, to });
}

export function stateAfterStatus(state, to) {
  return state === 'completed' && REOPEN_STATUSES.includes(to) ? 'delegated' : state;
}

export function withStatusChange(task, from, to, by, at, reason = undefined) {
  if (from === to) return task;
  const history = Array.isArray(task.statusHistory) ? task.statusHistory : [];
  const entry = { from: from ?? null, to, by: STATUS_ACTORS.includes(by) ? by : 'system', at, ...(reason ? { reason } : {}) };
  return { ...task, statusHistory: [...history, entry].slice(-STATUS_HISTORY_KEEP) };
}

export function defaultStatus(state) {
  if (state === 'running' || state === 'failed' || state === 'outcome_unknown') return 'in_progress';
  if (state === 'completed') return 'in_review';
  return 'todo';
}

export function statusAfterRun(status, state) {
  if (state === 'running' && (status === 'backlog' || status === 'todo')) return 'in_progress';
  if (state === 'completed' && ['backlog', 'todo', 'in_progress'].includes(status)) return 'in_review';
  return status;
}

export function taskPrompt(task) {
  const description = typeof task.description === 'string' ? task.description.trim() : '';
  return description ? `${task.summary}\n\n${description}` : String(task.summary ?? '');
}

export function taskRef(prefix, number) {
  return Number.isSafeInteger(number) ? `${prefix}-${number}` : null;
}

export function publicTask(task, prefix) {
  return {
    id: task.id,
    number: task.number ?? null,
    ref: taskRef(prefix, task.number),
    summary: task.summary,
    description: task.description || '',
    status: TASK_STATUSES.includes(task.status) ? task.status : defaultStatus(task.state),
    state: task.state,
    podId: task.podId || null,
    seatId: task.seatId || null,
    projectId: task.projectId || null,
    labels: Array.isArray(task.labels) ? task.labels : [],
    parentId: task.parentId || null,
    blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy : [],
    review: task.review ? { state: task.review.state, reviewer: task.review.reviewer, reason: task.review.reason || '', by: task.review.by || null, at: task.review.at || task.review.requestedAt } : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
