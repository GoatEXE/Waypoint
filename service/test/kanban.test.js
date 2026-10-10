import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KanbanBoard } from '../src/kanban.js';

async function board(statuses) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-kanban-'));
  const calls = [];
  const runner = async (_command, args) => {
    const kanban = args.slice(args.indexOf('kanban') + 1).filter((arg) => arg !== '--json');
    calls.push(kanban);
    const [verb, ...rest] = kanban;
    if (verb === 'list') return { code: 0, stdout: JSON.stringify(Object.keys(statuses).map((id) => ({ id, title: id, status: statuses[id] }))) };
    if (verb === 'show') return { code: 0, stdout: JSON.stringify({ task: { id: rest[0], title: rest[0], status: statuses[rest[0]] }, comments: [], events: [], parents: [], children: [] }) };
    if (verb === 'create') return { code: 0, stdout: JSON.stringify({ id: 't_cccccccc' }) };
    return { code: 0, stdout: '' };
  };
  const kanban = new KanbanBoard({ config: { dataDir }, hermes: { runner, containerName: 'ceo' }, organization: { get: async () => ({ key: 'SUN' }) } });
  return { kanban, calls };
}

test('board tasks get stable refs and comments route by status', async () => {
  const { kanban, calls } = await board({ t_aaaaaaaa: 'review', t_bbbbbbbb: 'blocked', t_cccccccc: 'running' });
  const { tasks } = await kanban.list();
  assert.deepEqual(tasks.map((t) => [t.id, t.ref]), [['t_cccccccc', 'SUN-3'], ['t_bbbbbbbb', 'SUN-2'], ['t_aaaaaaaa', 'SUN-1']]);
  assert.equal((await kanban.list()).tasks.at(-1).ref, 'SUN-1', 'refs never renumber');

  calls.length = 0;
  await kanban.comment('SUN-1', { text: 'Add tests first.' });
  assert.deepEqual(calls.slice(1, 2), [['request-changes', 't_aaaaaaaa', 'Add tests first.']], 'a comment on a task in review requests changes');
  calls.length = 0;
  await kanban.comment('sun-2', { text: 'Use the staging key.' });
  assert.deepEqual(calls.slice(1, 3), [['comment', '--author', 'user', 't_bbbbbbbb', 'Use the staging key.'], ['unblock', '--reason', 'user replied', 't_bbbbbbbb']], 'a reply unblocks a blocked task');
  await assert.rejects(kanban.comment('SUN-9', { text: 'x' }), /not found/);
  await assert.rejects(kanban.create({ title: 'x', assignee: 'Bad Seat' }), /seat id/);
});
