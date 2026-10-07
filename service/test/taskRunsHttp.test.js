import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { PodStore } from '../src/store.js';

const SECRET = 'sk-test-SHOULD-NEVER-LEAK-0123456789';
const TOOL_SECRET = 'TOOL-OUTPUT-MUST-NOT-APPEAR';
const templateInput = {
  name: 'run pod',
  version: '1',
  seats: [{ id: 'coder', role: 'implementation', instructions: 'write code' }, { id: 'reviewer', role: 'review', instructions: 'review code' }],
  baselineFiles: { 'SOUL.md': 'guidance' },
  config: { apiEnabled: false },
};
const json = { 'content-type': 'application/json' };

function stream(text = 'Done: hello.txt written.') {
  return [
    { type: 'system', subtype: 'init', session_id: 'sess_1' },
    { type: 'tool_use', name: 'terminal', input: { command: TOOL_SECRET } },
    { type: 'tool_result', name: 'terminal', output: `${TOOL_SECRET} ${SECRET}` },
    { type: 'result', session_id: 'sess_1', exit_code: 0, text, tokens: { input: 3, output: 4, total: 7 } },
  ].map((event) => JSON.stringify(event)).join('\n');
}

async function start({ dryRun = false, dataDir = undefined, ready = () => ({}), chat = async () => ({ code: 0, stdout: stream() }) } = {}) {
  dataDir ||= await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-runs-'));
  const app = await createApp({ PORT: '3081', HOST: '127.0.0.1', DATA_DIR: dataDir, WAYPOINT_CONTROL_DIR: path.join(dataDir, 'control'), LOG_LEVEL: 'error', HERMES_AUTO_START: 'false', DRY_RUN: String(dryRun) });
  const calls = { readiness: 0, workspace: 0, chat: 0 };
  app.taskExecutor.readiness = {
    async check({ seatId, containerName }) {
      calls.readiness += 1;
      const seat = { seatId, ready: true, provider: 'anthropic', model: 'claude-sonnet-5', authenticated: true, blockers: [], ...ready(seatId) };
      return { owned: true, running: true, containerName, seat };
    },
  };
  app.taskExecutor.runner = async (command, args, options) => {
    if (args.includes('python3')) {
      calls.workspace += 1;
      return { code: 0, stdout: JSON.stringify({ ok: true, path: `/opt/data/workspaces/${JSON.parse(options.input).taskId}`, created: true, files: 0, unchanged: 0 }) };
    }
    if (args.includes('chat')) {
      calls.chat += 1;
      return chat(args, options);
    }
    throw new Error(`unexpected docker call ${args[0]}`);
  };
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => app.bridgeServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const bridgeBase = `http://127.0.0.1:${app.bridgeServer.address().port}`;
  const template = await app.store.createTemplate(templateInput);
  const pod = await app.store.cloneTemplate(template.id, { podName: `pod-${Math.random().toString(16).slice(2, 8)}` }, ({ podId, podName }) => app.docker.startPlan({ podId, podName }));
  const podId = pod.id;
  const newTask = (seatId = 'coder') => app.store.createTask({ podId, seatId, summary: 'Write hello.txt' });
  const run = (taskId, body = {}) => fetch(`${base}/tasks/${taskId}/run`, { method: 'POST', headers: json, body: JSON.stringify(body) });
  const getTask = (taskId) => fetch(`${base}/tasks/${taskId}`).then((r) => r.json());
  const bridge = (tool, args) => fetch(`${bridgeBase}/bridge/tools`, { method: 'POST', headers: { ...json, authorization: `Bearer ${app.config.bridge.token}` }, body: JSON.stringify({ tool, args }) });
  const stop = () => Promise.all([app.server, app.bridgeServer].map((s) => new Promise((resolve) => s.close(resolve))));
  return { app, dataDir, calls, podId, bridgeBase, newTask, run, getTask, bridge, stop };
}

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

test('POST /tasks/:id/run returns 202 quickly, refuses duplicates, and persists the completed outcome', async () => {
  const hold = gate();
  const h = await start({ chat: async () => { await hold.promise; return { code: 0, stdout: stream() }; } });
  try {
    const task = await h.newTask();
    const response = await h.run(task.id);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.taskId, task.id);
    assert.match(body.runId, /^run_/);
    assert.equal(body.state, 'running');
    assert.match(body.message, /pod must already be running/);

    const running = await h.getTask(task.id);
    assert.equal(running.state, 'running');
    assert.equal(running.activeRunId, body.runId);

    const duplicate = await h.run(task.id);
    assert.equal(duplicate.status, 409);

    hold.release();
    await h.app.taskRuns.settled(task.id);
    const done = await h.getTask(task.id);
    assert.equal(done.state, 'completed');
    assert.equal(done.activeRunId, undefined);
    const last = done.runs.at(-1);
    assert.equal(last.id, body.runId);
    assert.equal(last.state, 'completed');
    assert.equal(last.reply, 'Done: hello.txt written.');
    assert.equal(last.sessionId, 'sess_1');
    assert.ok(done.evidence.some((entry) => entry.type === 'hermes_turn' && entry.runId === body.runId));
    assert.doesNotMatch(JSON.stringify(done), new RegExp(`${TOOL_SECRET}|${SECRET}`));
    assert.equal(h.calls.chat, 1);

    const again = await h.run(task.id);
    assert.equal(again.status, 409, 'a finished run needs manual review before any new run');
    assert.equal(h.calls.chat, 1);
  } finally { await h.stop(); }
});

test('only optional fixture files are accepted; bad input never claims a run', async () => {
  const h = await start();
  try {
    const task = await h.newTask();
    for (const body of [{ prompt: 'override' }, { files: [{ path: '../x', content: 'y' }] }, { manualRetry: true }, []]) {
      assert.equal((await h.run(task.id, body)).status, 400);
    }
    assert.equal((await h.run('task_00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await h.getTask(task.id)).state, 'delegated');
    assert.equal(h.calls.readiness + h.calls.chat, 0);
    const ok = await h.run(task.id, { files: [{ path: 'fixtures/input.txt', content: 'hi' }] });
    assert.equal(ok.status, 202);
    await h.app.taskRuns.settled(task.id);
  } finally { await h.stop(); }
});

test('preflight refusal aborts the claim back to delegated without a model call', async () => {
  const h = await start({ ready: () => ({ authenticated: false, ready: false, blockers: ['auth_not_ready'] }) });
  try {
    const task = await h.newTask();
    assert.equal((await h.run(task.id)).status, 202);
    await h.app.taskRuns.settled(task.id);
    const after = await h.getTask(task.id);
    assert.equal(after.state, 'delegated');
    assert.equal(after.runs.at(-1).state, 'aborted');
    assert.equal(after.runs.at(-1).reason, 'seat_auth_not_ready');
    assert.ok(after.evidence.some((entry) => entry.type === 'run_aborted'));
    assert.equal(h.calls.chat, 0);
    assert.equal(h.calls.workspace, 0);

    assert.equal((await h.run(task.id)).status, 202);
    await h.app.taskRuns.settled(task.id);
  } finally { await h.stop(); }
});

test('an unknown outcome locks the task with manual-review evidence and is never retried', async () => {
  const h = await start({ chat: async () => ({ code: 124, stdout: '' }) });
  try {
    const task = await h.newTask();
    assert.equal((await h.run(task.id)).status, 202);
    await h.app.taskRuns.settled(task.id);
    const after = await h.getTask(task.id);
    assert.equal(after.state, 'outcome_unknown');
    const turn = after.evidence.find((entry) => entry.type === 'hermes_turn');
    assert.equal(turn.retry, 'manual_review_required');
    assert.equal(turn.automaticRetry, false);
    assert.equal(turn.timedOut, true);
    const retry = await h.run(task.id);
    assert.equal(retry.status, 409);
    assert.match((await retry.json()).error.message, /manual review/);
    assert.equal(h.calls.chat, 1);
  } finally { await h.stop(); }
});

test('host-only manual retry requires review and keeps normal run locked', async () => {
  let turns = 0;
  const h = await start({ chat: async () => (++turns === 1 ? { code: 124, stdout: '' } : { code: 0, stdout: stream('Reviewed retry completed.') }) });
  try {
    const task = await h.newTask();
    const retry = (body) => fetch(`${h.app.server.address() ? `http://127.0.0.1:${h.app.server.address().port}` : ''}/tasks/${task.id}/manual-retry`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    assert.equal((await retry({ reviewed: true })).status, 409, 'delegated tasks use the ordinary run action');
    assert.equal((await h.run(task.id)).status, 202);
    await h.app.taskRuns.settled(task.id);
    assert.equal((await h.getTask(task.id)).state, 'outcome_unknown');
    for (const body of [{}, { reviewed: false }, { reviewed: true, prompt: 'override' }]) assert.equal((await retry(body)).status, 400);
    assert.equal((await h.run(task.id)).status, 409);
    assert.equal((await fetch(`${h.bridgeBase}/tasks/${task.id}/manual-retry`, { method: 'POST', headers: json, body: JSON.stringify({ reviewed: true }) })).status, 404);
    assert.equal((await retry({ reviewed: true })).status, 202);
    await h.app.taskRuns.settled(task.id);
    const after = await h.getTask(task.id);
    assert.equal(after.state, 'completed');
    assert.equal(after.runs.at(-1).manualRetry, true);
    assert.equal(after.runs.at(-1).reply, 'Reviewed retry completed.');
    assert.equal(h.calls.chat, 2);
  } finally { await h.stop(); }
});

test('an unexpected executor throw after claim is persisted as outcome_unknown', async () => {
  const h = await start();
  try {
    h.app.taskExecutor.execute = async () => { throw new Error(`boom ${SECRET}`); };
    const task = await h.newTask();
    assert.equal((await h.run(task.id)).status, 202);
    await h.app.taskRuns.settled(task.id);
    const after = await h.getTask(task.id);
    assert.equal(after.state, 'outcome_unknown');
    assert.ok(after.evidence.some((entry) => entry.type === 'run_error' && entry.retry === 'manual_review_required'));
    assert.doesNotMatch(JSON.stringify(after), new RegExp(SECRET));
  } finally { await h.stop(); }
});

test('a second task on a busy pod seat is refused before claiming; other seats still run', async () => {
  const hold = gate();
  const h = await start({ chat: async (args) => { if (args.includes('coder')) await hold.promise; return { code: 0, stdout: stream() }; } });
  try {
    const first = await h.newTask('coder');
    const second = await h.newTask('coder');
    const other = await h.newTask('reviewer');
    assert.equal((await h.run(first.id)).status, 202);
    const busy = await h.run(second.id);
    assert.equal(busy.status, 409);
    assert.match((await busy.json()).error.message, /pod seat already has an active run/);
    assert.equal((await h.getTask(second.id)).state, 'delegated');
    assert.equal((await h.getTask(second.id)).runs, undefined, 'no run claimed for the refused task');
    assert.equal((await h.run(other.id)).status, 202);
    await h.app.taskRuns.settled(other.id);
    assert.equal((await h.getTask(other.id)).state, 'completed');
    hold.release();
    await h.app.taskRuns.settled(first.id);
    assert.equal((await h.run(second.id)).status, 202, 'seat freed after the first run finished');
    await h.app.taskRuns.settled(second.id);
  } finally { await h.stop(); }
});

test('dry run returns the executor plan without claiming or running', async () => {
  const h = await start({ dryRun: true });
  try {
    const task = await h.newTask();
    const response = await h.run(task.id);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dryRun, true);
    assert.equal(body.executed, false);
    assert.equal(body.state, 'delegated');
    assert.ok(body.plan.some((step) => step.step === 'turn' && step.args.includes('--continue')));
    assert.match(body.message, /no run was claimed/);
    const after = await h.getTask(task.id);
    assert.equal(after.state, 'delegated');
    assert.equal(after.runs, undefined);
    assert.deepEqual(h.calls, { readiness: 0, workspace: 0, chat: 0 });

    const bridged = await (await h.bridge('run_task', { taskId: task.id })).json();
    assert.equal(bridged.dryRun, true);
    assert.equal(bridged.plan, undefined, 'bridge does not expose Docker argv');
  } finally { await h.stop(); }
});

test('bridge run_task returns promptly with the same service path and task_status reports the stored outcome', async () => {
  const hold = gate();
  const h = await start({ chat: async () => { await hold.promise; return { code: 0, stdout: stream('Seat reply.') }; } });
  try {
    const task = await h.newTask();
    assert.equal((await h.bridge('run_task', { taskId: task.id, prompt: 'override' })).status, 400);
    assert.equal((await h.bridge('run_task', { taskId: task.id, files: [] })).status, 400);
    assert.equal((await h.bridge('task_status', { taskId: task.id, extra: 1 })).status, 400);

    const started = await h.bridge('run_task', { taskId: task.id });
    assert.equal(started.status, 200);
    const body = await started.json();
    assert.equal(body.state, 'running');
    assert.match(body.runId, /^run_/);
    assert.equal((await h.bridge('run_task', { taskId: task.id })).status, 409);

    const running = await (await h.bridge('task_status', { taskId: task.id })).json();
    assert.equal(running.state, 'running');
    assert.equal(running.activeRunId, body.runId);

    hold.release();
    await h.app.taskRuns.settled(task.id);
    const status = await (await h.bridge('task_status', { taskId: task.id })).json();
    assert.equal(status.state, 'completed');
    assert.equal(status.manualReviewRequired, false);
    assert.equal(status.lastRun.id, body.runId);
    assert.equal(status.lastRun.reply, 'Seat reply.');
    assert.equal(status.activeRunId, null);
    assert.ok(status.evidence.length <= 8);
    assert.doesNotMatch(JSON.stringify(status), new RegExp(`${TOOL_SECRET}|${SECRET}|/opt/data/profiles|dataDir`));
    assert.equal((await fetch(`${h.bridgeBase}/tasks/${task.id}/run`, { method: 'POST', headers: json, body: '{}' })).status, 404, 'run route is not on the bridge port');
  } finally { await h.stop(); }
});

test('startup marks runs left running by a previous process as outcome_unknown before serving', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-runs-restart-'));
  const first = await start({ dataDir });
  const task = await first.newTask();
  await first.stop();

  const { runId } = await new PodStore(dataDir).claimTaskRun(task.id);
  const second = await start({ dataDir });
  try {
    const after = await second.getTask(task.id);
    assert.equal(after.state, 'outcome_unknown');
    assert.equal(after.runs.find((run) => run.id === runId).reason, 'service_restarted');
    assert.equal((await second.run(task.id)).status, 409);
    assert.equal(second.calls.chat, 0);
  } finally { await second.stop(); }
});

test('PUT /pod-instances/:podId/seats/:seatId/model persists only the seat model and never touches Docker', async () => {
  const h = await start();
  try {
    let dockerCalls = 0;
    h.app.podSeats.runner = async () => { dockerCalls += 1; throw new Error('no docker'); };
    h.app.docker.runner = async () => { dockerCalls += 1; throw new Error('no docker'); };
    const base = `http://127.0.0.1:${h.app.server.address().port}`;
    const put = (seatId, body, headers = json) => fetch(`${base}/pod-instances/${h.podId}/seats/${seatId}/model`, { method: 'PUT', headers, body: JSON.stringify(body) });
    const model = { provider: 'anthropic', default: 'claude-sonnet-5' };

    const saved = await put('coder', { model });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.podId, h.podId);
    assert.equal(body.seat.id, 'coder');
    assert.equal(body.seat.role, 'implementation');
    assert.equal(body.seat.model.provider, 'anthropic');
    assert.equal(body.seat.model.default, 'claude-sonnet-5');
    assert.deepEqual((await h.app.store.getInstance(h.podId)).seats.find((seat) => seat.id === 'coder').model, body.seat.model);

    for (const bad of [{ model, extra: 1 }, {}, { model: { ...model, api_key: SECRET } }, { model: { provider: 'nope', default: 'x' } }, []]) {
      const response = await put('coder', bad);
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), new RegExp(SECRET));
    }
    assert.equal((await put('ghost', { model })).status, 404);
    assert.equal((await put('coder', { model }, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await fetch(`${base}/pod-instances/pod_bad/seats/coder/model`, { method: 'PUT', headers: json, body: JSON.stringify({ model }) })).status, 400);
    assert.equal((await fetch(`${h.bridgeBase}/pod-instances/${h.podId}/seats/coder/model`, { method: 'PUT', headers: json, body: JSON.stringify({ model }) })).status, 404, 'not on the bridge port');

    const cleared = await (await put('coder', { model: null })).json();
    assert.equal(cleared.seat.model, null);
    assert.equal((await h.app.store.getInstance(h.podId)).seats.find((seat) => seat.id === 'coder').model, undefined);
    assert.equal(dockerCalls, 0);
    assert.deepEqual(h.calls, { readiness: 0, workspace: 0, chat: 0 });
  } finally { await h.stop(); }
});
