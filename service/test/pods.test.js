import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pods, rosterSkill } from '../src/pods.js';
import { APPLY_SCRIPT, LEARNING_SCRIPT, SNAPSHOT_SCRIPT } from '../src/podLearning.js';

test('a pod is a board plus seat clones with a roster; closing it reviews learning before the clones go', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-pods-'));
  const calls = [];
  const learned = { seat: 'web-builder', from: 'builder', kind: 'memory', path: 'MEMORY.md', change: 'added', text: 'The user wants test steps in every handoff.' };
  const hermes = {
    containerName: 'ceo',
    runner: async (_command, args) => { calls.push(args.slice(args.indexOf('ceo') + 2)); return { code: 0, stdout: args.includes('get') ? '- waypoint-seat\n' : '' }; },
    execPython: async (script, input) => {
      const body = JSON.parse(input);
      if (script === SNAPSHOT_SCRIPT) return { stdout: JSON.stringify(Object.fromEntries(body.seats.map((seat) => [seat, { 'pr-checklist': 'base' }]))) };
      if (script === LEARNING_SCRIPT) { calls.push(['learning', ...body.seats.map((seat) => `${seat.id}:${seat.baseline ? 'baseline' : 'none'}`)]); return { stdout: JSON.stringify({ items: [learned] }) }; }
      if (script === APPLY_SCRIPT) { calls.push(['apply', body.from, body.text]); return { stdout: '{"ok":true}' }; }
      calls.push(['roster', ...body.seats]);
      return { stdout: '{"ok":true}' };
    },
  };
  const orgSeats = { list: async () => ({ seats: [{ id: 'builder', description: 'Builds' }, { id: 'reviewer', description: 'Reviews' }] }) };
  const pods = new Pods({ config: { dataDir, dryRun: false }, hermes, board: {}, orgSeats });

  await assert.rejects(pods.create({ name: 'Web Squad', seats: ['builder'] }), /pod name/);
  await assert.rejects(pods.create({ name: 'web', seats: ['designer'] }), /existing organization seats/);
  assert.equal(calls.length, 0, 'bad input runs nothing');

  const pod = await pods.create({ name: 'web', purpose: 'Ship the landing page', seats: ['builder', 'reviewer'] });
  assert.deepEqual(pod.seats.map((seat) => [seat.id, seat.from]), [['web-builder', 'builder'], ['web-reviewer', 'reviewer']]);
  assert.deepEqual(calls[0].slice(0, 4), ['kanban', 'boards', 'create', 'pod-web']);
  assert.ok(calls.some((call) => call.join(' ') === 'profile create web-builder --no-alias --clone-from builder'));
  assert.ok(calls.some((call) => call.join(' ') === 'roster web-builder web-reviewer'));
  assert.ok(calls.some((call) => call.join(' ') === '-p web-reviewer config set skills.auto_load ["waypoint-seat","waypoint-pod"]'));
  assert.match(rosterSkill(pod), /- web-reviewer: Reviews \(cloned from reviewer\)/);
  assert.deepEqual([...await pods.seatIds()], ['web-builder', 'web-reviewer'], 'pod clones stay out of the org seat list');
  await assert.rejects(pods.create({ name: 'web', seats: ['builder'] }), /already exists/);

  const closed = await pods.close('web');
  assert.ok(calls.some((call) => call.join(' ') === 'kanban boards rm pod-web'));
  assert.ok(calls.some((call) => call.join(' ') === 'learning web-builder:baseline web-reviewer:baseline'), 'learning is measured against the clone-time baseline');
  assert.equal(closed.status, 'closed');
  assert.equal(closed.learning.items[0].decision, null);
  assert.equal(calls.some((call) => call[0] === 'profile' && call[1] === 'delete'), false, 'clones stay while learning is undecided');

  const settled = await pods.decide('web', closed.learning.items[0].id, { decision: 'apply' });
  assert.deepEqual(calls.find((call) => call[0] === 'apply'), ['apply', 'builder', learned.text]);
  assert.equal(settled.seatsRemoved, true);
  assert.deepEqual(calls.filter((call) => call[1] === 'delete').map((call) => call.at(-1)), ['web-builder', 'web-reviewer']);
  await assert.rejects(pods.decide('web', closed.learning.items[0].id, { decision: 'drop' }), /already decided/);
});
