import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PodStore } from '../src/store.js';
import { OrganizationStore } from '../src/organization.js';
import { TaskReviewService, reviewRequestText } from '../src/taskReviews.js';

const completed = { outcome: 'completed', text: 'Opened PR #12; checks pass.', sessionId: 'sess_1', durationMs: 1000, evidence: [] };

async function setup({ reviewer = undefined, podRunning = true, ceoRunning = true } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-reviews-'));
  const store = new PodStore(dataDir);
  const organization = new OrganizationStore(dataDir);
  await organization.update({ name: 'Sunchip', ...(reviewer ? { reviewer } : {}) });
  store.taskPrefix = async () => 'SUN';
  const template = await store.createTemplate({ name: 'team', version: '1', seats: [{ id: 'builder', role: 'Builder' }, { id: 'qa', role: 'QA' }] });
  const pod = await store.cloneTemplate(template.id, { podName: 'team' }, () => ({}));
  if (podRunning) await store.recordLifecycle(pod.id, { executed: true, dryRun: false, status: { state: 'running', running: true } }, () => ({}));
  const sent = [];
  const messaging = { async send(from, input, options) { const message = { id: `msg_${sent.length + 1}`, from, ...input, ...(options.review ? { review: options.review } : {}) }; sent.push(message); return message; } };
  const hermes = { inspect: async () => ({ exists: true, state: { running: ceoRunning } }) };
  const reviews = new TaskReviewService({ store, organization, messaging, hermes });
  const task = await store.createTask({ summary: 'Add a status filter', description: 'Acceptance: filter by status; npm run check passes.', podId: pod.id, seatId: 'builder' });
  const finish = async () => {
    const { runId } = await store.claimTaskRun(task.id);
    return store.finishTaskRun(task.id, runId, completed, { reviewer: await reviews.reviewer() });
  };
  return { store, organization, reviews, task, pod, sent, finish };
}

test('a finished run waits for the CEO reviewer, who can mark it done', async () => {
  const { store, reviews, task, sent, finish } = await setup();
  const finished = await finish();
  assert.equal(finished.status, 'in_progress', 'not in review until someone decides');
  assert.deepEqual([finished.review.state, finished.review.reviewer], ['pending', 'ceo']);
  await reviews.request(task.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ceo');
  assert.equal(sent[0].review, task.id);
  assert.match(sent[0].text, /Review request for SUN-1: "Add a status filter"[\s\S]*Opened PR #12[\s\S]*review_task/);
  await assert.rejects(reviews.decide(`${task.podId}/qa`, { taskId: 'SUN-1', decision: 'done', reason: 'ok' }), /Only the organization's reviewer/);
  const done = await reviews.decide('ceo', { taskId: 'SUN-1', decision: 'done', reason: 'PR opened and checks pass.' });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.statusHistory.at(-1), { from: 'in_progress', to: 'done', by: 'ceo', at: done.statusHistory.at(-1).at, reason: 'review' });
  assert.match(done.evidence.at(-1).message, /Reviewed as done \(ceo\): PR opened/);
  await assert.rejects(reviews.decide('ceo', { taskId: 'SUN-1', decision: 'done', reason: 'again' }), /not waiting for a review/);
});

test('a seat reviewer can send a task to the user, which lands it in review', async () => {
  const ctx = await setup();
  await assert.rejects(ctx.organization.update({ reviewer: 'someone' }), /reviewer must be ceo, me, or a pod seat address/);
  await ctx.organization.update({ reviewer: `${ctx.pod.id}/qa` });
  await ctx.finish();
  await ctx.reviews.request(ctx.task.id);
  assert.equal(ctx.sent[0].to, `${ctx.pod.id}/qa`);
  await assert.rejects(ctx.reviews.decide('ceo', { taskId: 'SUN-1', decision: 'done', reason: 'x' }), /Only the organization's reviewer/);
  await assert.rejects(ctx.reviews.decide(`${ctx.pod.id}/qa`, { taskId: 'SUN-1', decision: 'maybe', reason: 'x' }), /decision must be/);
  const flagged = await ctx.reviews.decide(`${ctx.pod.id}/qa`, { taskId: 'SUN-1', decision: 'needs_human', reason: 'Checks were not run.' });
  assert.equal(flagged.status, 'in_review');
  assert.deepEqual([flagged.review.state, flagged.review.by, flagged.review.reason], ['needs_human', 'seat', 'Checks were not run.']);
  assert.equal(flagged.statusHistory.at(-1).by, 'seat');
  const accepted = await ctx.store.updateTask(ctx.task.id, { status: 'done' });
  assert.equal(accepted.review.state, 'resolved');
});

test('reviews fall back to the user when the reviewer is unavailable or never decides, and "me" skips the agent', async () => {
  const offline = await setup({ ceoRunning: false });
  await offline.finish();
  const fallback = await offline.reviews.request(offline.task.id);
  assert.equal(fallback.status, 'in_review');
  assert.match(fallback.review.reason, /The CEO was not available/);
  assert.equal(offline.sent.length, 0);

  const silent = await setup();
  await silent.finish();
  await silent.reviews.request(silent.task.id);
  await silent.reviews.afterWake(silent.sent[0]);
  const settled = await silent.store.getTaskView(silent.task.id);
  assert.deepEqual([settled.status, settled.review.state], ['in_review', 'needs_human']);
  assert.match(settled.review.reason, /without recording a decision/);

  const human = await setup({ reviewer: 'me' });
  const mine = await human.finish();
  assert.deepEqual([mine.status, mine.review.state], ['in_review', 'needs_human']);
  const rerun = await human.store.claimTaskRun(human.task.id).catch((error) => error);
  assert.equal(rerun.status, 409, 'a completed run still needs reopening before another run');
  const reopened = await human.store.updateTask(human.task.id, { status: 'todo' });
  assert.equal(reopened.review.state, 'resolved');
  await human.store.claimTaskRun(human.task.id);
  assert.equal((await human.store.getTask(human.task.id)).review, undefined, 'a new run clears the old review');
});

test('review request text is bounded and tells the reviewer how to decide', () => {
  const text = reviewRequestText({ ref: 'SUN-9', summary: 'Big task', description: 'd'.repeat(5000), reply: 'r'.repeat(5000), seatId: 'builder' });
  assert.ok(text.length <= 3900);
  assert.match(text, /Seat builder finished its run/);
  assert.match(text, /"taskId": "SUN-9"/);
});
