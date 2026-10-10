import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pods, rosterSkill } from '../src/pods.js';

test('creating a pod makes its board and seat clones, writes the roster, and closing archives the board', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-pods-'));
  const calls = [];
  const hermes = {
    containerName: 'ceo',
    runner: async (_command, args) => { calls.push(args.slice(args.indexOf('ceo') + 2)); return { code: 0, stdout: args.includes('get') ? '- waypoint-seat\n' : '' }; },
    execPython: async (_script, input) => { calls.push(['roster', ...JSON.parse(input).seats]); return { stdout: '{"ok":true}' }; },
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
  assert.equal(closed.status, 'closed');
  assert.deepEqual(calls.at(-1), ['kanban', 'boards', 'rm', 'pod-web']);
});
