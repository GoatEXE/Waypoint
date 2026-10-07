import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyStreamEvent, finalActivity, normalizeActivity, streamLineReader } from '../src/activity.js';
import { createApp } from '../src/index.js';
import { PodTaskExecutor } from '../src/podTaskExecutor.js';
import { DockerAdapter } from '../src/docker.js';
import { loadConfig } from '../src/config.js';
import { seatAddress } from '../src/messaging.js';

const POD_ID = 'pod_11111111-2222-4333-8444-555555555555';
const TASK_ID = 'task_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('stream reader turns split tool events into redacted activity', () => {
  const items = [];
  const read = streamLineReader((event) => applyStreamEvent(items, event));
  read('{"type":"tool_use","name":"terminal","tool_call_id":"a","input":{"command":"curl -H \'Authorization: Bearer abcdefghijklmnopqrst\' x"}}\n{"type":"tool_use","name":"read_file","tool_call_id":"b","input":{"path":"src/a.js"}}\n{"type":"tool_res');
  read('ult","name":"terminal","tool_call_id":"a","output":"SECRET OUTPUT","duration_ms":12,"is_error":true}\nnot json\n');
  assert.deepEqual(items.map((item) => [item.name, item.status]), [['terminal', 'error'], ['read_file', 'running']]);
  assert.equal(items[0].detail.includes('abcdefghijklmnopqrst'), false);
  const final = finalActivity(items);
  assert.deepEqual(final[1], { kind: 'tool', name: 'read_file', detail: 'src/a.js', status: 'unknown' });
  assert.equal(JSON.stringify(final).includes('SECRET OUTPUT'), false);
  assert.deepEqual(normalizeActivity([{ kind: 'bogus' }, { kind: 'tool', name: '<b>x', status: 'weird' }]), [{ kind: 'tool', name: 'bx', detail: '', status: 'unknown' }]);
});

test('seat runs stream tool activity while running and return it with the result', async () => {
  const config = { ...loadConfig({ WAYPOINT_BRIDGE_TOKEN: 'a'.repeat(32) }, '/tmp'), dryRun: false };
  const container = new DockerAdapter(config).makeContainerName(POD_ID);
  const live = [];
  const seen = [];
  const runner = async (_command, args, options = {}) => {
    if (args.includes('python3')) return { code: 0, stdout: `${JSON.stringify({ ok: true, path: `/opt/data/workspaces/${TASK_ID}`, created: true, files: 0 })}\n`, timedOut: false };
    const stream = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'tool_use', name: 'write_file', tool_call_id: 't1', input: { path: 'hello.txt' } },
      { type: 'tool_result', name: 'write_file', tool_call_id: 't1', output: 'ok', duration_ms: 5, is_error: false },
      { type: 'result', session_id: 's1', exit_code: 0, text: 'Done.' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n';
    const cut = stream.indexOf('{"type":"tool_result"');
    options.onStdout?.(stream.slice(0, cut));
    seen.push(live.map((item) => item.status));
    options.onStdout?.(stream.slice(cut));
    return { code: 0, stdout: stream, timedOut: false };
  };
  const readiness = { check: async () => ({ owned: true, running: true, containerName: container, seat: { seatId: 'coder', ready: true, provider: 'anthropic', model: 'm', authenticated: true, blockers: [] } }) };
  const executor = new PodTaskExecutor({ config, docker: new DockerAdapter(config), readiness, runner });
  const result = await executor.execute({ task: { id: TASK_ID, podId: POD_ID, seatId: 'coder', summary: 'Write hello.txt' }, pod: { id: POD_ID, seats: [{ id: 'coder' }] }, activity: live });
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(seen, [['running']]);
  assert.deepEqual(result.activity, [{ kind: 'tool', name: 'write_file', detail: 'hello.txt', status: 'ok', durationMs: 5 }]);
});

test('messages can be linked to a task and listed for its thread', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-task-msg-'));
  const app = await createApp({ DATA_DIR: dataDir, HERMES_AUTO_START: 'false', LOG_LEVEL: 'error', DRY_RUN: 'true' });
  try {
    const template = await app.store.createTemplate({ name: 'team', version: '1', seats: [{ id: 'lead', role: 'Lead' }, { id: 'builder', role: 'Builder' }], baselineFiles: {}, config: {} });
    const pod = await app.store.cloneTemplate(template.id, { podName: 'alpha-team' }, () => ({}));
    const task = await app.store.createTask({ summary: 'Build it', podId: pod.id, seatId: 'builder' });
    const lead = seatAddress(pod.id, 'lead');
    const builder = seatAddress(pod.id, 'builder');
    await app.messaging.send(builder, { to: lead, text: 'Starting the build', taskId: task.ref });
    await app.messaging.send(lead, { to: builder, text: 'Unrelated note' });
    await assert.rejects(app.messaging.send(lead, { to: builder, text: 'x', taskId: 'WP-99' }), /taskId does not match/);
    const linked = await app.messaging.listTaskMessages(task.id);
    assert.deepEqual(linked.map((message) => [message.from, message.text, message.taskId]), [[builder, 'Starting the build', task.id]]);
    app.hermes.liveTurn = { threadId: task.id, activity: [] };
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve) => app.bridgeServer.listen(0, '127.0.0.1', resolve));
    const bridge = `http://127.0.0.1:${app.bridgeServer.address().port}/bridge/tools`;
    const sent = await fetch(bridge, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${app.config.bridge.token}` }, body: JSON.stringify({ tool: 'send_message', args: { to: lead, text: 'Please review' } }) });
    assert.equal(sent.status, 200);
    assert.deepEqual(app.hermes.liveTurn.activity.map((item) => item.name), ['send_message']);
    const listed = await fetch(`http://127.0.0.1:${app.server.address().port}/tasks/${task.ref}/messages`).then((r) => r.json());
    assert.deepEqual(listed.messages.map((message) => message.text).sort(), ['Please review', 'Starting the build']);
    const view = await fetch(`http://127.0.0.1:${app.server.address().port}/tasks/${task.ref}`).then((r) => r.json());
    assert.equal(view.liveActivity, null);
  } finally {
    app.hermes.liveTurn = null;
    await Promise.all([app.server, app.bridgeServer].map((s) => new Promise((resolve) => (s.listening ? s.close(resolve) : resolve()))));
  }
});
