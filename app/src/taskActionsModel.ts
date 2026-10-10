import type { BoardStatus, BoardTaskLink } from './api';

export type ConfirmKind = 'complete' | 'archive';

export interface ConfirmCopy { title: string; body: string; cta: string; busy: string }

export interface ActionContext { ref: string; status: BoardStatus; assignee: string | null; children?: BoardTaskLink[] }

export function waitingFollowUps(children: BoardTaskLink[] = []): BoardTaskLink[] {
  return children.filter(c => c.status === 'todo' || c.status === 'triage');
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function confirmCopy(kind: ConfirmKind, task: ActionContext): ConfirmCopy {
  const seat = task.assignee || 'the seat';
  if (kind === 'complete') {
    const body = task.status === 'blocked'
      ? `${seat} is waiting on your answer. Marking done closes the task without replying; use Reply to answer instead.`
      : `This closes the task now, even if ${seat} hasn't finished it.`;
    return { title: `Mark ${task.ref} done?`, body, cta: 'Mark done', busy: 'Marking done…' };
  }
  const waiting = waitingFollowUps(task.children);
  const body = waiting.length
    ? `Its ${plural(waiting.length, 'waiting follow-up')} (${waiting.map(c => c.ref || c.id).join(', ')}) will be archived too. Archived tasks are hidden from the board.`
    : 'Any follow-up tasks still waiting on it are archived too. Archived tasks are hidden from the board.';
  return { title: `Archive ${task.ref}?`, body, cta: 'Archive', busy: 'Archiving…' };
}

export function inboxPrimary(status: BoardStatus): 'reply' | 'approve' {
  return status === 'review' ? 'approve' : 'reply';
}

export function taskPrimary(status: BoardStatus): 'unblock' | 'comment' {
  return status === 'blocked' ? 'unblock' : 'comment';
}

export function commentPlaceholder(status: BoardStatus, assignee: string | null): string {
  if (status === 'review') return 'What needs to change?';
  if (!assignee) return 'Comment';
  if (status === 'blocked') return `Reply — ${assignee} reads this when it next works on the task`;
  return `Comment — ${assignee} reads this when it next works on the task`;
}
