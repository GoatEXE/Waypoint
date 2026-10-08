import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DockerAdapter } from '../src/docker.js';
import { loadConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import {
  ByteTail, MANUAL_REVIEW_NOTICE, PodTaskExecutor, TASK_WORKSPACE_SCRIPT, tailRunner, buildTaskChatArgs, parseTaskStream, podSeatsReadiness, sanitizeResponse, taskSessionName, taskWorkspacePath,
} from '../src/podTaskExecutor.js';

const POD_ID = 'pod_11111111-2222-4333-8444-555555555555';
const OTHER_POD_ID = 'pod_99999999-2222-4333-8444-555555555555';
const TASK_ID = 'task_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const WORKSPACE = `/opt/data/workspaces/${TASK_ID}`;
const SECRET = 'sk-test-SHOULD-NEVER-LEAK-0123456789';
const TOOL_SECRET = 'TOOL-OUTPUT-MUST-NOT-APPEAR';

function config(dryRun = false) {
  return { ...loadConfig({ WAYPOINT_BRIDGE_TOKEN: 'a'.repeat(32) }, '/tmp'), dryRun };
}
const docker = new DockerAdapter(config());
const CONTAINER = docker.makeContainerName(POD_ID);
function pod(overrides = {}) {
  return { id: POD_ID, podName: 'web-squad', seats: [{ id: 'lead' }, { id: 'coder' }], ...overrides };
}
function task(overrides = {}) {
  return { id: TASK_ID, podId: POD_ID, seatId: 'coder', summary: 'Write hello.txt', ...overrides };
}
function readyStatus(overrides = {}, seat = {}) {
  return { owned: true, running: true, containerName: CONTAINER, seat: { seatId: 'coder', ready: true, provider: 'anthropic', model: 'claude-sonnet-5', authenticated: true, blockers: [], ...seat }, ...overrides };
}
function streamLines(events) {
  return `${events.map((event) => JSON.stringify({ ...event, timestamp: 1 })).join('\n')}\n`;
}
const OK_STREAM = streamLines([
  { type: 'system', subtype: 'init', model: 'claude-sonnet-5', session_id: '20261006_abc' },
  { type: 'text', text: 'Working' },
  { type: 'tool_use', name: 'terminal', input: { command: `echo ${TOOL_SECRET}` } },
  { type: 'tool_result', name: 'terminal', output: `${TOOL_SECRET} ${SECRET}`, duration_ms: 3, is_error: false },
  { type: 'result', session_id: '20261006_abc', exit_code: 0, text: 'Created hello.txt.', tokens: { input: 10, output: 5, total: 15 }, duration_ms: 900 },
]);

function harness({ status = readyStatus(), checkError, workspace, workspaceCode = 0, chat = { code: 0, stdout: OK_STREAM }, dryRun = false, limits } = {}) {
  const calls = [];
  const checks = [];
  let clock = 1_000_000;
  const readiness = {
    async check(args) {
      checks.push(args);
      if (checkError) throw checkError;
      return status;
    },
  };
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    assert.equal(command, 'docker');
    if (args.includes('python3')) {
      const reply = workspace || { ok: true, path: `/opt/data/workspaces/${JSON.parse(options.input).taskId}`, created: true, files: 0 };
      return { code: workspaceCode, stdout: `noise\n${JSON.stringify(reply)}\n`, timedOut: false };
    }
    if (args.includes('chat')) {
      clock += 1234;
      if (chat instanceof Error) throw chat;
      return { timedOut: false, ...chat };
    }
    throw new Error(`unexpected docker call ${args.join(' ')}`);
  };
  const executor = new PodTaskExecutor({ config: config(dryRun), docker, readiness, runner, now: () => clock, limits });
  const chatCalls = () => calls.filter((call) => call.args.includes('chat'));
  return { executor, calls, checks, chatCalls };
}

function assertManualReview(result) {
  const turn = result.evidence.at(-1);
  assert.equal(turn.type, 'hermes_turn');
  assert.equal(turn.retry, 'manual_review_required');
  assert.equal(turn.automaticRetry, false);
  assert.ok(turn.message.endsWith(MANUAL_REVIEW_NOTICE), turn.message);
  assert.match(turn.message, /Manual review .* required before any retry; Waypoint never retries automatically\./);
}

async function rejectsApp(promise, status, pattern) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AppError, `expected AppError, got ${error}`);
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test('completed turn runs bounded hermes chat in the owned pod with task-scoped workspace and session', async () => {
  const h = harness();
  const result = await h.executor.execute({ task: task(), pod: pod(), files: [{ path: 'fixtures/input.txt', content: 'hi' }] });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.text, 'Created hello.txt.');
  assert.equal(result.sessionId, '20261006_abc');
  assert.equal(result.durationMs, 1234);
  assert.deepEqual(result.evidence.map((item) => item.type), ['readiness', 'workspace', 'hermes_turn']);
  assert.equal(result.evidence[2].toolCalls, 1);
  assert.deepEqual(result.evidence[2].tokens, { input: 10, output: 5, total: 15 });
  assert.equal(result.evidence[2].retry, undefined);
  assert.doesNotMatch(result.evidence[2].message, /Manual review/);

  assert.equal(h.checks.length, 1);
  assert.equal(h.checks[0].seatId, 'coder');
  assert.equal(h.checks[0].containerName, CONTAINER);
  const [workspaceCall, chatCall] = h.calls;
  assert.deepEqual(workspaceCall.args.slice(0, 7), ['exec', '-i', '--user', 'hermes', CONTAINER, 'python3', '-c']);
  assert.deepEqual(JSON.parse(workspaceCall.options.input), { taskId: TASK_ID, files: [{ path: 'fixtures/input.txt', content: 'hi' }] });
  assert.deepEqual(chatCall.args, [
    'exec', '-i', '--user', 'hermes', CONTAINER, 'timeout', '--kill-after=2s', '600s',
    'hermes', '-p', 'coder', 'chat', '--query-file', '-', '--format', 'stream-json', '--source', 'tool',
    '--in', WORKSPACE, '--continue', 'waypoint-task-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '--create-if-missing',
    '--run-budget', '540', '--max-turns', '40',
  ]);
  assert.equal(chatCall.options.input, 'Write hello.txt');
  assert.equal(chatCall.options.timeoutMs, 607000, 'host timeout exceeds in-container timeout plus kill-after');
  const serialized = JSON.stringify(h.calls.map((call) => call.args));
  assert.doesNotMatch(serialized, /-v|--volume|--mount|docker\.sock|bind|E:\\|\/Users\//);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${TOOL_SECRET}|${SECRET}`));
});

test('explicit prompt overrides the summary and is passed only on stdin', async () => {
  const h = harness();
  const prompt = 'Use $(rm -rf /) `literally` and "quotes"';
  await h.executor.execute({ task: task(), pod: pod(), prompt });
  const chatCall = h.chatCalls()[0];
  assert.equal(chatCall.options.input, prompt);
  assert.ok(!chatCall.args.includes(prompt));
});

test('mailbox turns keep Docker stdin open and guard the model process on disconnect', async () => {
  const h = harness();
  await h.executor.execute({ task: task(), pod: pod(), guardHostDisconnect: true });
  const call = h.chatCalls()[0];
  assert.equal(call.args[5], 'python3');
  assert.equal(call.options.keepStdinOpen, true);
  assert.deepEqual(JSON.parse(call.options.input), { prompt: 'Write hello.txt' });
  assert.equal(call.args.includes('Write hello.txt'), false);
});

test('tailRunner keeps stdin open until a guarded child exits', async () => {
  const script = 'let ended=false;process.stdin.on("end",()=>ended=true);process.stdin.once("data",()=>setTimeout(()=>{process.stdout.write(ended?"closed":"open");process.exit(0)},80))';
  const result = await tailRunner(process.execPath, ['-e', script], { input: 'start\n', keepStdinOpen: true, timeoutMs: 2000, outputLimitBytes: 100 });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'open');
});

test('refuses unowned, foreign-container, stopped, or failing readiness before workspace or model call', async () => {
  const cases = [
    [readyStatus({ owned: false }), 422, /ownership/],
    [readyStatus({ containerName: docker.makeContainerName(OTHER_POD_ID) }), 422, /different container/],
    [readyStatus({ running: false }), 409, /not running/],
    [readyStatus({}, { seatId: 'lead' }), 422, /task seat/],
    [null, 422, /ownership/],
  ];
  for (const [status, code, pattern] of cases) {
    const h = harness({ status });
    await rejectsApp(h.executor.execute({ task: task(), pod: pod() }), code, pattern);
    assert.equal(h.calls.length, 0, 'no docker exec after a refused readiness check');
  }
  const thrown = harness({ checkError: new Error(`boom ${SECRET}`) });
  await assert.rejects(thrown.executor.execute({ task: task(), pod: pod() }), (error) => error.status === 422 && !JSON.stringify(error).includes(SECRET) && !error.message.includes(SECRET));
  assert.equal(thrown.calls.length, 0);
});

test('no model call when provider auth or model is unavailable', async () => {
  const cases = [
    [{ authenticated: false, ready: false, blockers: ['auth_not_ready'] }, /auth is not ready/],
    [{ provider: '', model: '', ready: false, blockers: ['model_unconfigured'] }, /no configured provider\/model/],
    [{ ready: false, blockers: ['profile_not_seeded'] }, /not ready/],
    [{ blockers: ['model_not_applied'] }, /not ready/],
  ];
  for (const [seat, pattern] of cases) {
    const h = harness({ status: readyStatus({}, seat) });
    await rejectsApp(h.executor.execute({ task: task(), pod: pod() }), 409, pattern);
    assert.equal(h.chatCalls().length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('validates task, pod, seat, and prompt before any readiness check', async () => {
  const cases = [
    [{ task: task({ id: '../../etc' }), pod: pod() }, 400],
    [{ task: task({ id: `${TASK_ID}/x` }), pod: pod() }, 400],
    [{ task: task({ podId: OTHER_POD_ID }), pod: pod() }, 409],
    [{ task: task(), pod: pod({ id: 'pod_bad; rm -rf' }) }, 400],
    [{ task: task({ seatId: 'ghost' }), pod: pod() }, 409],
    [{ task: task({ seatId: 'Bad Seat;' }), pod: pod({ seats: [{ id: 'Bad Seat;' }] }) }, 400],
    [{ task: task({ seatId: 'default' }), pod: pod({ seats: [{ id: 'default' }] }) }, 400],
    [{ task: task({ summary: '   ' }), pod: pod() }, 400],
    [{ task: task(), pod: pod(), prompt: 'x'.repeat(16001) }, 400],
    [{ task: task(), pod: pod(), prompt: 'a\0b' }, 400],
    [{ task: null, pod: pod() }, 400],
  ];
  for (const [input, status] of cases) {
    const h = harness();
    await rejectsApp(h.executor.execute(input), status);
    assert.equal(h.checks.length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('fixture file paths and sizes are validated host-side', async () => {
  const bad = [
    [{ path: '../escape', content: 'x' }],
    [{ path: '/etc/passwd', content: 'x' }],
    [{ path: 'a/../../b', content: 'x' }],
    [{ path: '.hidden', content: 'x' }],
    [{ path: 'a//b', content: 'x' }],
    [{ path: 'a\\b', content: 'x' }],
    [{ path: 'a/b/c/d/e', content: 'x' }],
    [{ path: 'ok.txt', content: 42 }],
    [{ path: 'ok.txt', content: 'x' }, { path: 'ok.txt', content: 'y' }],
    [{ path: 'big.txt', content: 'x'.repeat(64 * 1024 + 1) }],
    Array.from({ length: 17 }, (_, i) => ({ path: `f${i}.txt`, content: 'x' })),
    'not-an-array',
  ];
  for (const files of bad) {
    const h = harness();
    await rejectsApp(h.executor.execute({ task: task(), pod: pod(), files }), 400);
    assert.equal(h.calls.length, 0);
  }
});

test('workspace path, session name, and argv are derived only from validated ids', () => {
  assert.equal(taskWorkspacePath(TASK_ID), WORKSPACE);
  assert.equal(taskSessionName(TASK_ID), 'waypoint-task-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.throws(() => taskWorkspacePath('task_../../x'), /invalid task id/);
  assert.throws(() => taskSessionName('--resume'), /invalid task id/);
  assert.throws(() => buildTaskChatArgs({ containerName: CONTAINER, seatId: '-p', taskId: TASK_ID, timeoutSeconds: 1, runBudgetSeconds: 1, maxTurns: 1 }), /invalid seat id/);
  assert.match(TASK_WORKSPACE_SCRIPT, /O_NOFOLLOW/);
  assert.match(TASK_WORKSPACE_SCRIPT, /realpath\(task\)!=task/);
  assert.match(TASK_WORKSPACE_SCRIPT, /WS=ROOT\+'\/workspaces'/);
});

test('workspace refusal or failure stops before the model call', async () => {
  for (const options of [{ workspace: { ok: false, error: 'not_a_directory' } }, { workspace: { ok: true, path: '/opt/data/profiles/coder' } }, { workspaceCode: 1 }]) {
    const h = harness(options);
    await rejectsApp(h.executor.execute({ task: task(), pod: pod() }), 422, /workspace could not be prepared/);
    assert.equal(h.chatCalls().length, 0);
  }
});

test('in-container and host timeouts return outcome_unknown without retrying', async () => {
  for (const chat of [{ code: 124, stdout: streamLines([{ type: 'system', subtype: 'init', session_id: 's1' }, { type: 'text', text: 'partial' }]) }, { code: 137, stdout: '' }, { code: null, stdout: '', timedOut: true }]) {
    const h = harness({ chat });
    const result = await h.executor.execute({ task: task(), pod: pod() });
    assert.equal(result.outcome, 'outcome_unknown');
    assert.equal(result.text, '');
    assert.equal(result.evidence.at(-1).timedOut, true);
    assertManualReview(result);
    assert.equal(h.chatCalls().length, 1, 'never retried');
  }
  const h = harness({ chat: { code: 124, stdout: streamLines([{ type: 'system', subtype: 'init', session_id: 's1' }]) } });
  assert.equal((await h.executor.execute({ task: task(), pod: pod() })).sessionId, 's1');
});

test('missing result, runner crash, and Hermes-reported failures are not treated as success', async () => {
  const noResult = harness({ chat: { code: 0, stdout: streamLines([{ type: 'system', subtype: 'init', session_id: 's1' }, { type: 'text', text: 'half' }]) } });
  const nr = await noResult.executor.execute({ task: task(), pod: pod() });
  assert.equal(nr.outcome, 'outcome_unknown');
  assertManualReview(nr);

  const crashed = harness({ chat: new Error('spawn failed') });
  const crash = await crashed.executor.execute({ task: task(), pod: pod() });
  assert.equal(crash.outcome, 'outcome_unknown');
  assertManualReview(crash);

  const notStarted = harness({ chat: { code: 125, stdout: '' } });
  const ns = await notStarted.executor.execute({ task: task(), pod: pod() });
  assert.equal(ns.outcome, 'failed');
  assert.equal(ns.evidence.at(-1).modelTurnStarted, false);
  assertManualReview(ns);

  const failed = harness({ chat: { code: 1, stdout: streamLines([{ type: 'system', subtype: 'init', session_id: 's2' }, { type: 'result', session_id: 's2', exit_code: 1, text: '', error: `provider 401 api_key=${SECRET}` }]) } });
  const f = await failed.executor.execute({ task: task(), pod: pod() });
  assert.equal(f.outcome, 'failed');
  assert.equal(f.sessionId, 's2');
  assertManualReview(f);
  assert.doesNotMatch(JSON.stringify(f), new RegExp(SECRET));
  assert.match(f.evidence.at(-1).error, /api_key=\[redacted/);

  const empty = harness({ chat: { code: 0, stdout: streamLines([{ type: 'result', session_id: 's3', exit_code: 0, text: '' }]) } });
  const e = await empty.executor.execute({ task: task(), pod: pod() });
  assert.equal(e.outcome, 'outcome_unknown');
  assertManualReview(e);
  for (const h of [noResult, crashed, notStarted, failed, empty]) assert.equal(h.chatCalls().length, 1, 'never retried automatically');
});

test('stream parser ignores tool/user events and non-JSON noise', () => {
  const stdout = [
    'not json',
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'bad id with spaces' }),
    JSON.stringify({ type: 'tool_use', name: 'terminal', input: { command: TOOL_SECRET } }),
    JSON.stringify({ type: 'tool_result', name: 'terminal', output: TOOL_SECRET, text: TOOL_SECRET }),
    JSON.stringify({ type: 'text', role: 'user', text: TOOL_SECRET }),
    JSON.stringify({ type: 'text', role: 'tool', text: TOOL_SECRET }),
    JSON.stringify({ type: 'text', text: 'Hello ' }),
    JSON.stringify({ type: 'text', role: 'assistant', text: 'world' }),
  ].join('\n');
  const parsed = parseTaskStream(stdout);
  assert.equal(parsed.text, 'Hello world');
  assert.equal(parsed.sessionId, '');
  assert.equal(parsed.toolCalls, 1);
  assert.equal(parsed.result, null);
  assert.doesNotMatch(JSON.stringify(parsed), new RegExp(TOOL_SECRET));
});

test('final text is the result record only, redacted, stripped of control codes, and capped', async () => {
  const longText = `Done. Bearer abcdefghijklmnopqrstuvwxyz ${SECRET} ghp_${'a'.repeat(36)} \x1b[31mred\x1b[0m\x07 ${'z'.repeat(9000)}`;
  const h = harness({ chat: { code: 0, stdout: streamLines([
    { type: 'text', text: 'streamed delta that differs' },
    { type: 'tool_result', name: 'read_file', output: TOOL_SECRET },
    { type: 'result', session_id: 's4', exit_code: 0, text: longText },
  ]) } });
  const result = await h.executor.execute({ task: task(), pod: pod() });
  assert.equal(result.outcome, 'completed');
  assert.ok(result.text.length <= 8000);
  assert.match(result.text, /\[truncated\]$/);
  assert.match(result.text, /^Done\. Bearer \[redacted\] \[redacted:key\] \[redacted:key\] red /);
  assert.doesNotMatch(result.text, /streamed delta|\x1b|\x07/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${SECRET}|${TOOL_SECRET}`));
  assert.equal(sanitizeResponse('x'.repeat(100), 64).length, 64);
});

test('limits are configurable and bounded', async () => {
  const h = harness({ limits: { turnTimeoutMs: 60000, maxTurns: 5, maxResponseChars: 64 } });
  await h.executor.execute({ task: task(), pod: pod() });
  const args = h.chatCalls()[0].args;
  assert.equal(args[7], '60s');
  assert.equal(args[args.indexOf('--run-budget') + 1], '54');
  assert.equal(args[args.indexOf('--max-turns') + 1], '5');
  assert.throws(() => harness({ limits: { maxTurns: 0 } }), /invalid pod task limit/);
  assert.throws(() => harness({ limits: { turnTimeoutMs: 999999999 } }), /invalid pod task limit/);
});

test('dry run returns a plan without readiness, workspace, or model calls', async () => {
  const h = harness({ dryRun: true });
  const result = await h.executor.execute({ task: task(), pod: pod() });
  assert.equal(result.outcome, 'dry_run');
  assert.equal(h.checks.length, 0);
  assert.equal(h.calls.length, 0);
  const plan = result.evidence[0].plan;
  assert.equal(plan.at(-1).args.includes('--continue'), true);
  assert.doesNotMatch(JSON.stringify(plan), /import json/);
});

test('concurrent turns for the same task are refused', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness();
  const original = h.executor.runner;
  h.executor.runner = async (command, args, options) => {
    if (args.includes('chat')) await gate;
    return original(command, args, options);
  };
  const first = h.executor.execute({ task: task(), pod: pod() });
  await new Promise((resolve) => setImmediate(resolve));
  await rejectsApp(h.executor.execute({ task: task(), pod: pod() }), 409, /active Hermes turn/);
  release();
  assert.equal((await first).outcome, 'completed');
  assert.equal((await h.executor.execute({ task: task(), pod: pod() })).outcome, 'completed', 'lock released after completion');
});

test('podSeatsReadiness maps PodSeats.inspect output and refuses dry-run or unconfigured models', async () => {
  const inspectCalls = [];
  const report = (seat) => ({ podId: POD_ID, executed: true, dryRun: false, containerName: CONTAINER, seats: [seat] });
  const fake = (value) => ({ async inspect(instance, options) { inspectCalls.push(options); return value; } });

  const ready = await podSeatsReadiness(fake(report({ seatId: 'coder', ready: true, blockers: [], model: { requested: { provider: 'anthropic', default: 'claude-sonnet-5' } }, auth: { providers: { anthropic: { authenticated: true } } } }))).check({ pod: pod(), seatId: 'coder' });
  assert.deepEqual(inspectCalls[0], { seatIds: ['coder'], template: undefined, checkAuth: true });
  assert.deepEqual(ready, readyStatus());

  const unconfigured = podSeatsReadiness(fake(report({ seatId: 'coder', ready: false, blockers: ['model_unconfigured'], model: { requested: null }, auth: { providers: { 'openai-codex': { authenticated: true } } } })));
  const h = harness();
  h.executor.readiness = unconfigured;
  await rejectsApp(h.executor.execute({ task: task(), pod: pod() }), 409, /no configured provider\/model/);
  assert.equal(h.calls.length, 0);

  const dry = await podSeatsReadiness(fake({ dryRun: true, executed: false })).check({ pod: pod(), seatId: 'coder' });
  assert.equal(dry.owned, false);
});

test('concurrent turns on the same pod seat are refused even for different task ids', async () => {
  const OTHER_TASK_ID = 'task_bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const THIRD_TASK_ID = 'task_cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness();

  h.executor.readiness = { check: async ({ seatId, containerName }) => { h.checks.push({ seatId }); return readyStatus({ containerName }, { seatId }); } };
  const original = h.executor.runner;
  let inFlight = 0;
  h.executor.runner = async (command, args, options) => {
    if (args.includes('chat') && args.includes(CONTAINER) && args.includes('coder') && inFlight === 0) {
      inFlight += 1;
      await gate;
    }
    return original(command, args, options);
  };
  const first = h.executor.execute({ task: task(), pod: pod() });
  for (let i = 0; i < 50 && inFlight === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inFlight, 1, 'first turn is in flight');

  const checksBefore = h.checks.length;
  const callsBefore = h.calls.length;
  await rejectsApp(h.executor.execute({ task: task({ id: OTHER_TASK_ID }), pod: pod() }), 409, /pod seat already has an active Hermes turn/);
  assert.equal(h.checks.length, checksBefore, 'refused before readiness');
  assert.equal(h.calls.length, callsBefore, 'refused before workspace or model call');

  assert.equal((await h.executor.execute({ task: task({ id: OTHER_TASK_ID, seatId: 'lead' }), pod: pod() })).outcome, 'completed');
  const otherPod = pod({ id: OTHER_POD_ID });
  assert.equal((await h.executor.execute({ task: task({ id: THIRD_TASK_ID, podId: OTHER_POD_ID }), pod: otherPod })).outcome, 'completed');

  release();
  assert.equal((await first).outcome, 'completed');
  assert.equal(h.executor.activeSeats.size, 0);
  assert.equal((await h.executor.execute({ task: task({ id: OTHER_TASK_ID }), pod: pod() })).outcome, 'completed', 'seat lock released after completion');
});

test('task and seat locks are released after a refused readiness check or an unknown outcome', async () => {
  const refused = harness({ status: readyStatus({ running: false }) });
  await rejectsApp(refused.executor.execute({ task: task(), pod: pod() }), 409, /not running/);
  assert.equal(refused.executor.activeSeats.size, 0);
  assert.equal(refused.executor.activeTasks.size, 0);
  const unknown = harness({ chat: { code: 124, stdout: '' } });
  assert.equal((await unknown.executor.execute({ task: task(), pod: pod() })).outcome, 'outcome_unknown');
  assert.equal(unknown.executor.activeSeats.size, 0);
  assert.equal(unknown.executor.activeTasks.size, 0);
});

test('workspace reuse reports created/unchanged fixtures, and a changed fixture refuses without a model call', async () => {
  const reused = harness({ workspace: { ok: true, path: WORKSPACE, created: false, files: 0, unchanged: 2 } });
  const result = await reused.executor.execute({ task: task(), pod: pod(), files: [{ path: 'a.txt', content: 'one' }, { path: 'dir/b.txt', content: 'two' }] });
  const workspace = result.evidence.find((item) => item.type === 'workspace');
  assert.equal(workspace.fixturesCreated, 0);
  assert.equal(workspace.fixturesUnchanged, 2);
  assert.match(workspace.message, /reused; 0 fixture file\(s\) created, 2 already present and unchanged; existing files are never overwritten/);

  const changed = harness({ workspace: { ok: false, error: 'fixture_conflict' } });
  await rejectsApp(changed.executor.execute({ task: task(), pod: pod(), files: [{ path: 'a.txt', content: 'one' }] }), 409, /nothing was overwritten and no model call was made\. Review the workspace manually before any retry/);
  assert.equal(changed.chatCalls().length, 0);

  const collision = harness();
  await rejectsApp(collision.executor.execute({ task: task(), pod: pod(), files: [{ path: 'a', content: 'x' }, { path: 'a/b', content: 'y' }] }), 400, /also used as a directory/);
  assert.equal(collision.calls.length, 0);
});

const PYTHON = ['python3', 'python'].find((bin) => spawnSync(bin, ['-c', 'import os; os.O_NOFOLLOW'], { stdio: 'ignore' }).status === 0);
test('real workspace script is non-destructive on repeat and changed workspaces', { skip: process.platform === 'win32' || !PYTHON ? 'needs POSIX python3 (O_NOFOLLOW)' : false }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-task-ws-'));
  try {
    const script = TASK_WORKSPACE_SCRIPT.replace("ROOT='/opt/data'", `ROOT=${JSON.stringify(fs.realpathSync(root))}`);
    assert.notEqual(script, TASK_WORKSPACE_SCRIPT);
    const run = (files, taskId = TASK_ID) => JSON.parse(spawnSync(PYTHON, ['-c', script], { input: JSON.stringify({ taskId, files }), encoding: 'utf8' }).stdout.trim().split('\n').at(-1));
    const ws = path.join(fs.realpathSync(root), 'workspaces', TASK_ID);
    const fixtures = [{ path: 'a.txt', content: 'one' }, { path: 'dir/b.txt', content: 'two\n' }];

    assert.deepEqual(run(fixtures), { ok: true, path: ws, created: true, files: 2, unchanged: 0 });
    assert.deepEqual(run(fixtures), { ok: true, path: ws, created: false, files: 0, unchanged: 2 });

    fs.writeFileSync(path.join(ws, 'dir/b.txt'), 'seat edit');
    assert.deepEqual(run([...fixtures, { path: 'c.txt', content: 'new' }]), { ok: false, error: 'fixture_conflict' });
    assert.equal(fs.readFileSync(path.join(ws, 'dir/b.txt'), 'utf8'), 'seat edit');
    assert.equal(fs.existsSync(path.join(ws, 'c.txt')), false, 'no partial writes after a refusal');

    fs.writeFileSync(path.join(ws, 'a.txt'), 'ONE');
    assert.deepEqual(run([fixtures[0]]), { ok: false, error: 'fixture_conflict' });
    fs.rmSync(path.join(ws, 'a.txt'));
    assert.deepEqual(run([fixtures[0]]), { ok: true, path: ws, created: false, files: 1, unchanged: 0 });

    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside');
    fs.symlinkSync(path.join(root, 'outside.txt'), path.join(ws, 'link.txt'));
    assert.deepEqual(run([{ path: 'link.txt', content: 'outside' }]), { ok: false, error: 'not_a_file' });
    const other = 'task_bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    fs.symlinkSync(root, path.join(root, 'workspaces', other));
    assert.deepEqual(run([], other), { ok: false, error: 'not_a_directory' });
    assert.equal(fs.readFileSync(path.join(root, 'outside.txt'), 'utf8'), 'outside');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tailRunner keeps multibyte UTF-8 split across chunks intact and caps the tail in bytes', async () => {
  const split = await tailRunner(process.execPath, ['-e', "process.stdout.write(Buffer.from([0xe2, 0x82])); setTimeout(() => process.stdout.write(Buffer.from([0xac, 0x0a])), 50);"], { timeoutMs: 10000, outputLimitBytes: 1024 });
  assert.equal(split.code, 0);
  assert.equal(split.stdout, '€\n');

  const capped = await tailRunner(process.execPath, ['-e', "for (let i = 0; i < 20; i += 1) process.stdout.write('€'.repeat(50));"], { timeoutMs: 10000, outputLimitBytes: 100 });
  assert.ok(Buffer.byteLength(capped.stdout) <= 100, `tail is ${Buffer.byteLength(capped.stdout)} bytes`);
  assert.ok(capped.stdout.length > 0);
  assert.doesNotMatch(capped.stdout, /�/, 'cut is moved to a character boundary');
  assert.match(capped.stdout, /^€+$/);
});

test('ByteTail counts bytes, compacts beyond twice the limit, and trims a partial leading character', () => {
  const tail = new ByteTail(4);
  for (const byte of Buffer.from('a€€')) tail.push(Buffer.from([byte]));
  assert.ok(tail.bytes <= 8);
  assert.equal(tail.text(), '€', 'last 4 bytes start mid-character; the orphan byte is dropped');
  const ascii = new ByteTail(3);
  ascii.push('abcdef');
  assert.equal(ascii.text(), 'def');
});

test('partial assistant text is capped by the configured response limit, not the default', async () => {
  const deltas = Array.from({ length: 20 }, () => ({ type: 'text', text: 'x'.repeat(10) }));
  assert.equal(parseTaskStream(streamLines(deltas), { maxTextChars: 64 }).text.length, 64);
  assert.equal(parseTaskStream(streamLines(deltas), { maxTextChars: 64 }).textTruncated, true);
  assert.equal(parseTaskStream(streamLines(deltas)).textTruncated, false);

  const h = harness({ limits: { maxResponseChars: 64 }, chat: { code: 124, stdout: streamLines([{ type: 'system', subtype: 'init', session_id: 's9' }, ...deltas]) } });
  const result = await h.executor.execute({ task: task(), pod: pod() });
  assert.equal(result.outcome, 'outcome_unknown');
  assert.equal(result.evidence.at(-1).partialTextChars, 64);
  assert.equal(result.evidence.at(-1).partialTextTruncated, true);
});

test('local project runs work in the mounted folder with git settings passed through env', () => {
  const args = buildTaskChatArgs({ containerName: 'c1', seatId: 'coder', taskId: TASK_ID, timeoutSeconds: 60, runBudgetSeconds: 50, maxTurns: 5, workdir: '/opt/data/projects/project_1', env: ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', 'GIT_CONFIG_VALUE_0=/opt/data/projects/project_1'] });
  assert.equal(args[args.indexOf('--in') + 1], '/opt/data/projects/project_1');
  assert.deepEqual(args.slice(args.indexOf('env'), args.indexOf('-p') - 1), ['env', 'GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', 'GIT_CONFIG_VALUE_0=/opt/data/projects/project_1']);
  assert.equal(buildTaskChatArgs({ containerName: 'c1', seatId: 'coder', taskId: TASK_ID, timeoutSeconds: 60, runBudgetSeconds: 50, maxTurns: 5 }).includes('env'), false);
});
