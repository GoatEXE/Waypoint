import { badRequest, forbidden } from './errors.js';

const REVIEW_DECISIONS = ['done', 'needs_human'];
const REASON_MAX = 300;
const DESCRIPTION_MAX = 1200;
const REPLY_MAX = 1600;

export const SEAT_ADDRESS_RE = /^pod_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z][a-z0-9_-]{1,62}$/;

function clip(text, max) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function reviewRequestText(task) {
  const lines = [
    `Review request for ${task.ref || task.id}: "${task.summary}".`,
    `${task.seatId ? `Seat ${task.seatId}` : 'The seat'} finished its run. Decide whether the result meets the task without the user's input.`,
    task.description ? `\nTask description:\n${clip(task.description, DESCRIPTION_MAX)}` : '',
    `\nThe seat's reply:\n${clip(task.reply, REPLY_MAX) || '(no reply text)'}`,
    `\nRecord your decision with review_task { "taskId": "${task.ref || task.id}", "decision": "done" or "needs_human", "reason": "one sentence" }.`,
    'Choose needs_human when the work is incomplete, unverified, risky, or needs the user\'s judgment. This request does not authorize running tasks or other changes.',
  ];
  return lines.filter(Boolean).join('\n').slice(0, 3900);
}

export class TaskReviewService {
  constructor({ store, organization, messaging, hermes, logger = undefined }) {
    this.store = store;
    this.organization = organization;
    this.messaging = messaging;
    this.hermes = hermes;
    this.logger = logger;
  }

  async reviewer() {
    const value = (await this.organization?.get())?.reviewer;
    return value === 'me' || SEAT_ADDRESS_RE.test(String(value || '')) ? value : 'ceo';
  }

  async available(reviewer) {
    if (reviewer === 'ceo') {
      const inspected = await this.hermes?.inspect?.({ allowMissing: true }).catch(() => null);
      return Boolean(inspected?.exists && inspected.state?.running);
    }
    const [podId, seatId] = reviewer.split('/');
    const pod = await this.store.getInstance(podId).catch(() => null);
    return Boolean(pod && pod.state === 'running' && pod.seats.some((seat) => seat.id === seatId));
  }

  async request(taskId) {
    const task = await this.store.getTaskView(taskId);
    if (task.review?.state !== 'pending') return task;
    const reviewer = task.review.reviewer;
    if (!this.messaging || !(await this.available(reviewer))) {
      return this.store.recordReview(task.id, { decision: 'needs_human', reason: `${reviewer === 'ceo' ? 'The CEO' : `Reviewer ${reviewer.split('/')[1]}`} was not available to review this task.`, by: 'system' });
    }
    const lastRun = (task.runs || []).find((run) => run.id === task.lastRunId);
    const from = task.podId && task.seatId ? `${task.podId}/${task.seatId}` : 'ceo';
    const message = await this.messaging.send(from, { to: reviewer, text: reviewRequestText({ ...task, reply: lastRun?.reply }), taskId: task.id }, { review: task.id });
    this.logger?.info?.('task_review_requested', { taskId: task.id, reviewer, messageId: message.id });
    return this.store.noteReviewMessage(task.id, message.id);
  }

  async decide(actor, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw badRequest('args must be an object');
    const reviewer = await this.reviewer();
    if (actor !== reviewer) throw forbidden('Only the organization\'s reviewer can review tasks.');
    const decision = String(args.decision || '');
    if (!REVIEW_DECISIONS.includes(decision)) throw badRequest('decision must be done or needs_human');
    const reason = typeof args.reason === 'string' ? args.reason.trim().replace(/\s+/g, ' ') : '';
    if (!reason || reason.length > REASON_MAX) throw badRequest(`reason must be 1-${REASON_MAX} characters`);
    const taskId = await this.store.resolveTaskId(String(args.taskId || ''));
    return this.store.recordReview(taskId, { decision, reason, by: actor === 'ceo' ? 'ceo' : 'seat', actor });
  }

  async afterWake(message) {
    if (!message?.review) return;
    const task = await this.store.getTask(message.review).catch(() => null);
    if (task?.review?.state !== 'pending') return;
    await this.store.recordReview(task.id, { decision: 'needs_human', reason: 'The reviewer finished without recording a decision.', by: 'system' });
  }
}
