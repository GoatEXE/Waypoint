import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SeatFeedback, buildSeatChatArgs } from '../src/seatFeedback.js';
import { loadConfig } from '../src/config.js';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.input = '';
    this.stdin = new Writable({ write: (chunk, _e, cb) => { this.input += String(chunk); cb(); } });
  }
  kill() {}
}

async function setup(assignee = 'dev') {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-feedback-'));
  const config = loadConfig({ DATA_DIR: dataDir }, dataDir);
  const spawns = [];
  const hermes = {
    containerName: 'waypoint-hermes-ceo',
    spawner: (command, args) => {
      const child = new FakeChild();
      spawns.push({ args, child });
      setImmediate(() => {
        child.stdout.emit('data', '{"type":"result","session_id":"s1","text":"Noted. I saved: always run the tests first."}\n');
        child.emit('close', 0);
      });
      return child;
    },
  };
  const board = { show: async () => ({ id: 't_abc123', ref: 'WP-4', title: 'Fix login', assignee, latestSummary: 'Fixed it.' }) };
  return { feedback: new SeatFeedback({ config, hermes, board }), spawns };
}

test('feedback runs a chat on the assigned seat and keeps the thread', async () => {
  const { feedback, spawns } = await setup();
  const result = await feedback.send('dev', 'WP-4', { message: 'Run the tests before handing in.' });
  assert.equal(result.messages.at(-1).role, 'seat');
  assert.match(result.messages.at(-1).text, /saved/);
  const args = spawns[0].args;
  assert.deepEqual(args.slice(args.lastIndexOf('hermes'), args.lastIndexOf('hermes') + 4), ['hermes', '-p', 'dev', 'chat']);
  assert.ok(args.includes('waypoint-feedback-t_abc123'));
  assert.match(spawns[0].child.input, /feedback on task WP-4 "Fix login"/);
  await feedback.send('dev', 'WP-4', { message: 'Thanks.' });
  assert.equal(spawns[1].child.input, 'Thanks.');
  assert.equal((await feedback.conversation('dev', 'WP-4')).messages.length, 4);
});

test('feedback only goes to the seat that worked the task', async () => {
  const { feedback } = await setup('qa');
  await assert.rejects(feedback.send('dev', 'WP-4', { message: 'hi' }), /assigned to the task/);
  await assert.rejects(feedback.send('Bad Seat', 'WP-4', { message: 'hi' }), /seat id/);
  await assert.rejects(feedback.send('qa', 'WP-4', { message: '' }), /message must be/);
});

test('seat chat args use the seat profile and a named session', () => {
  const args = buildSeatChatArgs('c', 'dev', 'waypoint-feedback-t_1', { ceoTurnTimeoutMs: 60000, ceoMaxTurns: 20 });
  assert.ok(args.includes('--create-if-missing'));
  assert.equal(args[args.indexOf('--continue') + 1], 'waypoint-feedback-t_1');
});
