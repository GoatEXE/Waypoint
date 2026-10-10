import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KanbanBoard } from '../src/kanban.js';

async function board(statuses, children = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-kanban-'));
  const calls = [];
  const runner = async (_command, args) => {
    let kanban = args.slice(args.indexOf('kanban') + 1).filter((arg) => arg !== '--json');
    const board = kanban[0] === '--board' ? kanban[1] : 'default';
    if (board !== 'default') kanban = kanban.slice(2);
    calls.push(board === 'default' ? kanban : [`@${board}`, ...kanban]);
    const [verb, ...rest] = kanban;
    if (verb === 'boards') return { code: 0, stdout: JSON.stringify([{ slug: 'default' }]) };
    if (verb === 'list') return { code: 0, stdout: JSON.stringify(Object.keys(statuses).map((id) => ({ id, title: id, status: statuses[id] }))) };
    if (verb === 'show') return { code: 0, stdout: JSON.stringify({ task: { id: rest[0], title: rest[0], status: statuses[rest[0]] }, comments: [], events: [], parents: [], children: children[rest[0]] || [] }) };
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

test('archiving a task also archives the follow-ups waiting on it, so they never start', async () => {
  const { kanban, calls } = await board({ t_aaaaaaaa: 'review', t_bbbbbbbb: 'todo', t_cccccccc: 'done' }, { t_aaaaaaaa: ['t_bbbbbbbb', 't_cccccccc'] });
  await kanban.act('t_aaaaaaaa', { action: 'archive' });
  assert.deepEqual(calls.filter((c) => c[0] === 'archive'), [['archive', 't_bbbbbbbb'], ['archive', 't_aaaaaaaa']]);
});

test('approving a task with a repo contract finds its PR in the handoff', async () => {
  const { publishedPr } = await import('../src/kanban.js');
  const handoff = (summary, metadata) => ({ task: { completion_contract: 'Acme/Site' }, latest_summary: '', events: [{ kind: 'review_requested', payload: { summary, ...(metadata ? { metadata } : {}) } }] });
  assert.equal(publishedPr(handoff('See https://github.com/other/repo/pull/3 and https://github.com/acme/site/pull/12.')), 'https://github.com/acme/site/pull/12');
  assert.equal(publishedPr(handoff('Done.', { published_pr: 'https://github.com/Acme/Site/pull/7' })), 'https://github.com/Acme/Site/pull/7');
  assert.equal(publishedPr({ task: {}, events: [] }), null, 'no contract, no PR needed');
});

test('a pod board task keeps its board for later reads and actions', async () => {
  const { kanban, calls } = await board({ t_cccccccc: 'review' });
  const created = await kanban.create({ title: 'Draft the plan', assignee: 'web-builder', board: 'pod-web' });
  assert.equal(created.board, 'pod-web');
  calls.length = 0;
  await kanban.act(created.ref, { action: 'unblock' });
  assert.ok(calls.length && calls.every((call) => call[0] === '@pod-web'), 'every call for the task goes to its board');
  await assert.rejects(kanban.create({ title: 'x', board: 'Bad Board' }), /board slug/);
});
