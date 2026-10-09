import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PodStore } from '../src/store.js';
import { taskPrompt } from '../src/taskQueue.js';

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-runs-')); }
function planFactory({ podId }) { return { command: 'docker', args: [], labels: {}, volumeName: `vol-${podId}`, containerName: `ctr-${podId}` }; }

async function setup() {
  const dataDir = await tmp();
  const store = new PodStore(dataDir);
  const template = await store.createTemplate({ name: 'runs', version: '1', seats: [{ id: 'coder', role: 'implementation' }] });
  const pod = await store.cloneTemplate(template.id, { podName: 'runs-pod' }, planFactory);
  const task = await store.createTask({ podId: pod.id, seatId: 'coder', summary: 'write the report' });
  return { dataDir, store, pod, task };
}
const completed = (overrides = {}) => ({
  outcome: 'completed',
  text: 'Report written.',
  sessionId: 'sess_123',
  durationMs: 1200,
  evidence: [
    { type: 'readiness', message: 'Owned running pod; seat coder ready with anthropic auth.', at: '2026-10-06T10:00:00.000Z' },
    { type: 'hermes_turn', message: 'Hermes turn completed with a final assistant response.', at: '2026-10-06T10:00:01.000Z', exitCode: 0, timedOut: false, toolCalls: 2, tokens: { input: 10, output: 5, total: 15 } },
  ],
  ...overrides,
});

test('concurrent claims on one task yield exactly one running run', async () => {
  const { store, task } = await setup();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => store.claimTaskRun(task.id)));
  const won = results.filter((result) => result.status === 'fulfilled');
  assert.equal(won.length, 1);
  for (const result of results.filter((item) => item.status === 'rejected')) assert.equal(result.reason.status, 409);
  const stored = await store.getTask(task.id);
  assert.equal(stored.state, 'running');
  assert.equal(stored.activeRunId, won[0].value.runId);
  assert.match(stored.activeRunId, /^run_[0-9a-f-]{36}$/);
  assert.equal(stored.runs.length, 1);
  assert.deepEqual(stored.evidence, task.evidence);
});

test('a persisted running run refuses new claims after restart unless manually retried', async () => {
  const { dataDir, store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);

  await assert.rejects(store.claimTaskRun(task.id, { manualRetry: true }), (error) => error.status === 409);

  const restarted = new PodStore(dataDir);
  await assert.rejects(restarted.claimTaskRun(task.id), (error) => error.status === 409 && error.details.state === 'running');
  assert.equal((await restarted.getTask(task.id)).activeRunId, runId);

  const retried = await restarted.claimTaskRun(task.id, { manualRetry: true });
  const stored = await restarted.getTask(task.id);
  assert.equal(stored.state, 'running');
  assert.equal(stored.activeRunId, retried.runId);
  assert.equal(stored.runs.find((run) => run.id === runId).state, 'outcome_unknown');
  assert.ok(stored.evidence.some((entry) => entry.type === 'run_interrupted' && entry.runId === runId));

  await assert.rejects(restarted.finishTaskRun(task.id, runId, completed()), (error) => error.status === 409);
});

test('failed and outcome_unknown results lock the task, including after restart', async () => {
  for (const outcome of ['failed', 'outcome_unknown']) {
    const { dataDir, store, task } = await setup();
    const { runId } = await store.claimTaskRun(task.id);
    const finished = await store.finishTaskRun(task.id, runId, completed({ outcome, text: '' }));
    assert.equal(finished.state, outcome);
    assert.equal(finished.activeRunId, undefined);
    assert.equal(finished.lastRunId, runId);
    await assert.rejects(store.claimTaskRun(task.id), (error) => error.status === 409 && error.details.state === outcome);
    await assert.rejects(new PodStore(dataDir).claimTaskRun(task.id), (error) => error.status === 409 && error.details.state === outcome);
    const retry = await new PodStore(dataDir).claimTaskRun(task.id, { manualRetry: true });
    const stored = await store.getTask(task.id);
    assert.equal(stored.runs.length, 2);
    assert.deepEqual(stored.runs.at(-1), { id: retry.runId, state: 'running', startedAt: stored.runs.at(-1).startedAt, fromState: outcome, fromStatus: 'in_progress', manualRetry: true });
  }
});

test('finish and abort only accept the active run id', async () => {
  const { store, task } = await setup();
  await assert.rejects(store.finishTaskRun(task.id, 'run_00000000-0000-4000-8000-000000000000', completed()), (error) => error.status === 409);
  const { runId } = await store.claimTaskRun(task.id);
  await assert.rejects(store.finishTaskRun(task.id, 'run_00000000-0000-4000-8000-000000000000', completed()), (error) => error.status === 409);
  await assert.rejects(store.finishTaskRun(task.id, '../escape', completed()), (error) => error.status === 400);
  await assert.rejects(store.abortTaskRun(task.id, 'run_00000000-0000-4000-8000-000000000000'), (error) => error.status === 409);
  await store.finishTaskRun(task.id, runId, completed());

  await assert.rejects(store.finishTaskRun(task.id, runId, completed({ outcome: 'failed' })), (error) => error.status === 409);
  await assert.rejects(store.abortTaskRun(task.id, runId), (error) => error.status === 409);
  assert.equal((await store.getTask(task.id)).state, 'completed');
});

test('invalid outcomes are rejected and leave the run locked', async () => {
  const { store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);
  for (const outcome of ['dry_run', 'succeeded', undefined]) {
    await assert.rejects(store.finishTaskRun(task.id, runId, completed({ outcome })), (error) => error.status === 400);
  }
  await assert.rejects(store.finishTaskRun(task.id, runId, null), (error) => error.status === 400);
  const stored = await store.getTask(task.id);
  assert.equal(stored.state, 'running');
  assert.equal(stored.activeRunId, runId);
});

test('abort before any model turn returns the task to delegated and allows a new claim', async () => {
  const { store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);
  const aborted = await store.abortTaskRun(task.id, runId, { reason: 'lifecycle_error' });
  assert.equal(aborted.state, 'delegated');
  assert.equal(aborted.activeRunId, undefined);
  assert.equal(aborted.runs[0].state, 'aborted');
  assert.equal(aborted.runs[0].reason, 'lifecycle_error');
  assert.deepEqual(task.evidence, [], 'a new task starts with no evidence');
  assert.equal(aborted.lastRunId, runId);
  assert.ok(!aborted.runs.some((run) => run.state === 'running'));
  assert.equal(aborted.evidence.at(-1).type, 'run_aborted');
  assert.equal(aborted.evidence.at(-1).reason, 'lifecycle_error');
  assert.equal(aborted.evidence.at(-1).runId, runId);
  const next = await store.claimTaskRun(task.id);
  assert.notEqual(next.runId, runId);

  const dry = await store.abortTaskRun(task.id, next.runId, { reason: 'Not A Code /etc/passwd' });
  assert.equal(dry.runs.at(-1).reason, 'preflight_failed');
});

test('aborting a manual retry restores the previous locked outcome', async () => {
  const { store, task } = await setup();
  const first = await store.claimTaskRun(task.id);
  await store.finishTaskRun(task.id, first.runId, completed({ outcome: 'outcome_unknown', text: '' }));
  const retry = await store.claimTaskRun(task.id, { manualRetry: true });
  const aborted = await store.abortTaskRun(task.id, retry.runId, { reason: 'conflict' });
  assert.equal(aborted.state, 'outcome_unknown');
  await assert.rejects(store.claimTaskRun(task.id), (error) => error.status === 409);
});

test('completion persists a sanitized, capped reply and allowlisted evidence', async () => {
  const { dataDir, store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);
  const longReply = `Saved to ${path.join(dataDir, 'instances', 'x.txt')} and C:\\Users\\someone\\secret.txt with key sk-abcdefghijklmnop.\u0007\n${'x'.repeat(9000)}`;
  const evidence = [
    ...completed().evidence,
    { type: 'dry_run', message: 'plan', at: 'not a date', plan: [{ command: 'docker', args: ['exec', 'secret'] }], stderr: 'boom', toolResult: { output: 'raw' }, args: ['--token', 'x'] },
    { type: 'Bad Type!', message: `oops at /home/dustin/.hermes/auth.json ${'m'.repeat(1000)}`, error: `Bearer abcdefghijklmnopqrstuvwxyz ${'e'.repeat(500)}`, retry: 'auto', automaticRetry: false },
    'not an object',
    ...Array.from({ length: 10 }, (_, index) => ({ type: 'note', message: `extra ${index}` })),
  ];
  const finished = await store.finishTaskRun(task.id, runId, { outcome: 'completed', text: longReply, sessionId: 'bad session id; rm -rf', durationMs: -5, evidence });
  const run = finished.runs.at(-1);
  assert.equal(finished.state, 'completed');
  assert.equal(run.state, 'completed');
  assert.equal(run.sessionId, null);
  assert.equal(run.durationMs, null);
  assert.equal(run.replyTruncated, true);
  assert.ok(run.reply.length <= 8000);
  assert.ok(run.reply.endsWith('[truncated]'));
  assert.ok(!run.reply.includes(dataDir));
  assert.ok(!run.reply.includes('C:\\Users'));
  assert.ok(!run.reply.includes('sk-abcdefghijklmnop'));
  assert.ok(!run.reply.includes('\u0007'));
  assert.match(run.reply, /\[host-path\]/);
  assert.ok(typeof run.finishedAt === 'string');

  const runEntries = finished.evidence.filter((entry) => entry.runId === runId);
  assert.equal(runEntries.length, 8);
  assert.deepEqual(runEntries[1], { type: 'hermes_turn', message: 'Hermes turn completed with a final assistant response.', at: '2026-10-06T10:00:01.000Z', runId, exitCode: 0, toolCalls: 2, timedOut: false, tokens: { input: 10, output: 5, total: 15 } });
  const dropped = runEntries[2];
  assert.deepEqual(Object.keys(dropped).sort(), ['at', 'message', 'runId', 'type']);
  assert.ok(!Number.isNaN(Date.parse(dropped.at)));
  const odd = runEntries[3];
  assert.equal(odd.type, 'note');
  assert.ok(odd.message.length <= 500);
  assert.ok(!odd.message.includes('/home/dustin'));
  assert.ok(odd.error.length <= 200);
  assert.ok(!odd.error.includes('abcdefghijklmnopqrstuvwxyz'));
  assert.equal(odd.retry, undefined);
  assert.equal(odd.automaticRetry, false);
  const serialized = JSON.stringify(await store.getTask(task.id));
  for (const forbidden of ['stderr', 'toolResult', '"plan":', '"args":', '/home/dustin', dataDir.replaceAll('\\', '\\\\')]) assert.ok(!serialized.includes(forbidden), forbidden);
});

test('valid session id, duration, and short reply are kept as reported', async () => {
  const { store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);
  const finished = await store.finishTaskRun(task.id, runId, completed());
  const run = finished.runs[0];
  assert.equal(run.sessionId, 'sess_123');
  assert.equal(run.durationMs, 1200);
  assert.equal(run.reply, 'Report written.');
  assert.equal(run.replyTruncated, false);
  assert.equal(run.fromState, 'delegated');
});

test('run history and run evidence stay bounded across manual retries', async () => {
  const { store, task } = await setup();
  for (let index = 0; index < 14; index += 1) {
    const { runId } = await store.claimTaskRun(task.id, { manualRetry: true });
    await store.finishTaskRun(task.id, runId, completed({ evidence: Array.from({ length: 8 }, () => ({ type: 'note', message: 'n' })) }));
  }
  const stored = await store.getTask(task.id);
  assert.equal(stored.runs.length, 10);
  assert.equal(stored.evidence.filter((entry) => entry.runId).length, 32);
});

test('missions linked to a task still report the task state', async () => {
  const { store, task } = await setup();
  const { mission } = await store.createMission({ title: 'Report', taskId: task.id });
  const { runId } = await store.claimTaskRun(task.id);
  await store.finishTaskRun(task.id, runId, completed());
  const view = await store.getMission(mission.id);
  assert.equal(view.state, 'delegated');
  assert.equal(view.task.state, 'completed');
  assert.deepEqual(view.missing, []);
});

test('unknown task ids are rejected without touching storage', async () => {
  const { store } = await setup();
  await assert.rejects(store.claimTaskRun('../task'), (error) => error.status === 400);
  await assert.rejects(store.claimTaskRun('task_00000000-0000-4000-8000-000000000000'), (error) => error.status === 404);
});

test('startup reconciliation marks runs from a previous process as outcome_unknown, idempotently', async () => {
  const { dataDir, store, pod } = await setup();
  const make = (summary) => store.createTask({ podId: pod.id, seatId: 'coder', summary });
  const [interrupted, delegated, done, failed] = await Promise.all(['a', 'b', 'c', 'd'].map(make));
  const { runId } = await store.claimTaskRun(interrupted.id);
  const doneRun = await store.claimTaskRun(done.id);
  await store.finishTaskRun(done.id, doneRun.runId, completed());
  const failedRun = await store.claimTaskRun(failed.id);
  await store.finishTaskRun(failed.id, failedRun.runId, completed({ outcome: 'failed', text: '' }));

  await fs.writeFile(path.join(dataDir, 'tasks', 'notes.json'), JSON.stringify({ state: 'running' }));
  await fs.writeFile(path.join(dataDir, 'tasks', 'task_bad.json'), JSON.stringify({ state: 'running' }));
  const before = await Promise.all([delegated, done, failed].map((task) => store.getTask(task.id)));

  assert.deepEqual(await store.markInterruptedTaskRuns(), []);
  assert.equal((await store.getTask(interrupted.id)).state, 'running');

  const restarted = new PodStore(dataDir);
  assert.deepEqual(await restarted.markInterruptedTaskRuns(), [{ taskId: interrupted.id, runId }]);
  const closed = await restarted.getTask(interrupted.id);
  assert.equal(closed.state, 'outcome_unknown');
  assert.equal(closed.activeRunId, undefined);
  assert.equal(closed.lastRunId, runId);
  assert.equal(closed.runs.length, 1);
  assert.equal(closed.runs[0].state, 'outcome_unknown');
  assert.equal(closed.runs[0].reason, 'service_restarted');
  assert.equal(closed.evidence.length, 1);
  const note = closed.evidence.at(-1);
  assert.equal(note.type, 'run_interrupted');
  assert.equal(note.runId, runId);
  assert.match(note.message, /outcome is unknown/);

  assert.deepEqual(await restarted.markInterruptedTaskRuns(), []);
  assert.deepEqual(await restarted.getTask(interrupted.id), closed);
  assert.deepEqual(await Promise.all([delegated, done, failed].map((task) => restarted.getTask(task.id))), before);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'tasks', 'notes.json'), 'utf8')), { state: 'running' });

  await assert.rejects(restarted.claimTaskRun(interrupted.id), (error) => error.status === 409 && error.details.state === 'outcome_unknown');
  await assert.rejects(restarted.finishTaskRun(interrupted.id, runId, completed()), (error) => error.status === 409);
});

test('startup reconciliation tolerates a missing tasks folder', async () => {
  const store = new PodStore(await tmp());
  assert.deepEqual(await store.markInterruptedTaskRuns(), []);
});

test('status changes follow allowed transitions and leave an audit trail with the actor', async () => {
  const { store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);
  await assert.rejects(store.updateTask(task.id, { status: 'done' }, { actor: 'ceo' }), (error) => error.status === 409 && /while a run is in progress/.test(error.message));
  await store.finishTaskRun(task.id, runId, completed());
  const reviewed = await store.getTaskView(task.id);
  assert.equal(reviewed.status, 'in_review');
  assert.equal(reviewed.state, 'completed');
  await assert.rejects(store.claimTaskRun(task.id), (error) => error.status === 409);

  const reopened = await store.updateTask(task.id, { status: 'todo' }, { actor: 'ceo' });
  assert.equal(reopened.state, 'delegated');
  assert.equal(reopened.evidence.at(-1).type, 'reopened');
  const rerun = await store.claimTaskRun(task.id);
  await store.finishTaskRun(task.id, rerun.runId, completed());
  const done = await store.updateTask(task.id, { status: 'done' });
  await assert.rejects(store.updateTask(task.id, { status: 'canceled' }), (error) => error.status === 400 && /allowed: todo, in_review/.test(error.message));
  assert.deepEqual(done.statusHistory.map(({ from, to, by, reason }) => [from, to, by, reason ?? null]), [
    [null, 'todo', 'user', 'created'],
    ['todo', 'in_progress', 'system', 'run_started'],
    ['in_progress', 'in_review', 'system', 'run_completed'],
    ['in_review', 'todo', 'ceo', null],
    ['todo', 'in_progress', 'system', 'run_started'],
    ['in_progress', 'in_review', 'system', 'run_completed'],
    ['in_review', 'done', 'user', null],
  ]);
  assert.ok(done.statusHistory.every((entry) => !Number.isNaN(Date.parse(entry.at))));
});

test('moving a failed task back to todo does not bypass manual review', async () => {
  const { store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);
  await store.finishTaskRun(task.id, runId, completed({ outcome: 'failed' }));
  const moved = await store.updateTask(task.id, { status: 'todo' }, { actor: 'ceo' });
  assert.equal(moved.state, 'failed');
  await assert.rejects(store.claimTaskRun(task.id), (error) => error.status === 409 && /manual review/.test(error.message));
});

test('a run released before any model turn restores the prior status', async () => {
  const { store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);
  const released = await store.abortTaskRun(task.id, runId, { reason: 'pod_not_running' });
  assert.equal(released.status, 'todo');
  assert.deepEqual(released.statusHistory.slice(-2).map(({ to, reason }) => [to, reason]), [['in_progress', 'run_started'], ['todo', 'run_aborted']]);
});

test('requesting changes reopens a reviewed task and gives the seat the feedback on its next run', async () => {
  const { store, task } = await setup();
  const { runId } = await store.claimTaskRun(task.id);
  await store.finishTaskRun(task.id, runId, completed(), { reviewer: 'me' });
  await assert.rejects(store.requestChanges(task.id, { text: '' }), /feedback must be/);
  const reopened = await store.requestChanges(task.id, { text: 'Install deps with npm install in app/ and service/, then open the PR.' });
  assert.deepEqual([reopened.status, reopened.state, reopened.review.state], ['todo', 'delegated', 'resolved']);
  assert.equal(reopened.statusHistory.at(-1).reason, 'changes_requested');
  assert.equal(reopened.evidence.at(-1).type, 'feedback');
  const prompt = taskPrompt(await store.getTask(task.id));
  assert.match(prompt, /^write the report\n\nThe user reviewed your previous run and asked for these changes\. Address them, continuing from the work already in this workspace:\n- Install deps with npm install/);
  await store.claimTaskRun(task.id);
  await assert.rejects(store.requestChanges(task.id, { text: 'more' }), /running/);
});
