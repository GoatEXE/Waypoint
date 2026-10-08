import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PodStore } from '../src/store.js';
import { SeatChatService, seatChatTaskId, seatThreadId } from '../src/seatChat.js';

async function until(check) {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check());
}

async function setup({ dryRun = false } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-seat-chat-'));
  const store = new PodStore(dataDir);
  const template = await store.createTemplate({ name: 'team', version: '1', seats: [{ id: 'lead', role: 'Lead' }] });
  const pod = await store.cloneTemplate(template.id, { podName: 'alpha' }, () => ({}));
  const calls = [];
  let release;
  const executor = {
    async execute(args) {
      calls.push(args);
      args.activity.push({ kind: 'tool', name: 'terminal', detail: 'ls', status: 'running', at: 'now' });
      await new Promise((resolve) => { release = resolve; });
      args.activity[0].status = 'ok';
      return calls.length === 3 ? { outcome: 'outcome_unknown', text: '' } : { outcome: 'completed', text: `reply ${calls.length}` };
    },
  };
  const chat = new SeatChatService({ config: { dataDir, dryRun }, store, executor });
  return { chat, pod, calls, release: () => release() };
}

test('seat chat runs a bounded seat turn with live activity and keeps the conversation', async () => {
  const { chat, pod, calls, release } = await setup();
  assert.deepEqual((await chat.conversation(pod.id, 'lead')).messages, []);
  const first = chat.send(pod.id, 'lead', { message: 'What are you working on?' });
  await until(() => calls.length === 1);
  const live = await chat.conversation(pod.id, 'lead');
  assert.equal(live.busyThreadId, seatThreadId(pod.id, 'lead'));
  assert.deepEqual(live.live.items.map((item) => item.status), ['running']);
  await assert.rejects(chat.send(pod.id, 'lead', { message: 'again' }), /already answering/);
  release();
  const done = await first;
  assert.deepEqual(done.messages.map((m) => m.role), ['user', 'activity', 'seat']);
  assert.equal(done.reply, 'reply 1');
  assert.equal(calls[0].task.id, seatChatTaskId(pod.id, 'lead'));
  assert.equal(calls[0].task.seatId, 'lead');
  assert.match(calls[0].prompt, /talking with you directly as seat lead \(Lead\)/);
  assert.match(calls[0].prompt, /What are you working on\?$/);

  const second = chat.send(pod.id, 'lead', { message: 'Thanks' });
  await until(() => calls.length === 2);
  release();
  await second;
  assert.equal(calls[1].prompt, 'Thanks');
  assert.equal(calls[1].task.id, calls[0].task.id);

  const third = chat.send(pod.id, 'lead', { message: 'Still there?' });
  await until(() => calls.length === 3);
  release();
  const unknown = await third;
  assert.equal(unknown.messages.at(-1).status, 'outcome_unknown');
  assert.equal((await chat.conversation(pod.id, 'lead')).messages.length, 9);
});

test('seat chat validates the seat and refuses in dry-run mode', async () => {
  const { chat, pod } = await setup({ dryRun: true });
  await assert.rejects(chat.send(pod.id, 'nobody', { message: 'hi' }), /seat not found/);
  await assert.rejects(chat.send(pod.id, 'lead', { message: '' }), /message must be/);
  await assert.rejects(chat.send(pod.id, 'lead', { message: 'hi', extra: 1 }), /body must be/);
  await assert.rejects(chat.send(pod.id, 'lead', { message: 'hi' }), /dry-run/);
  await assert.rejects(chat.conversation('pod_bad', 'lead'), /invalid pod or seat/);
});
