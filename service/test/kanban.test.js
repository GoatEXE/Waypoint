import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KanbanBoard } from '../src/kanban.js';
import { fakeHermes } from './fakeHermes.js';

const GENERAL = { id: 'project_00000000-0000-4000-8000-000000000001', name: 'General', repo: null, general: true };
const SITE = { id: 'project_00000000-0000-4000-8000-000000000002', name: 'Site', repo: 'acme/site' };

function withProjects(kanban) {
  const byId = { [GENERAL.id]: GENERAL, [SITE.id]: SITE };
  kanban.store = { getProject: async (id) => { if (!byId[id]) throw Object.assign(new Error('project not found'), { status: 404 }); return byId[id]; } };
  kanban.projects = { ensure: async (project) => ({ slug: project.general ? 'wp-general' : 'wp-site', hermesId: project.general ? 'p_general' : 'p_site' }), byHermesId: async () => ({ p_general: GENERAL.id, p_site: SITE.id }) };
  return kanban;
}

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
    if (verb === 'show') return { code: 0, stdout: JSON.stringify({ task: { id: rest[0], title: rest[0], status: statuses[rest[0]], project_id: rest[0] === 't_aaaaaaaa' ? 'p_site' : null }, comments: [], events: [], parents: [], children: children[rest[0]] || [] }) };
    if (verb === 'create') return { code: 0, stdout: JSON.stringify({ id: 't_cccccccc' }) };
    return { code: 0, stdout: '' };
  };
  const kanban = new KanbanBoard({ config: { dataDir }, hermes: fakeHermes({ runner }), organization: { get: async () => ({ key: 'SUN' }) } });
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
  withProjects(kanban);
  const created = await kanban.create({ title: 'Draft the plan', assignee: 'web-builder', board: 'pod-web', project: GENERAL.id });
  assert.equal(created.board, 'pod-web');
  calls.length = 0;
  await kanban.act(created.ref, { action: 'unblock' });
  assert.ok(calls.length && calls.every((call) => call[0] === '@pod-web'), 'every call for the task goes to its board');
  await assert.rejects(kanban.create({ title: 'x', board: 'Bad Board' }), /board slug/);
});

test('requesting changes on a handed-in task with no review run comments and reopens it', async () => {
  const { kanban, calls } = await board({ t_aaaaaaaa: 'review' });
  await kanban.list();
  const runner = kanban.hermes.runner;
  kanban.hermes.runner = async (command, args) => args.includes('request-changes')
    ? { code: 1, stdout: '', stderr: 'cannot request changes for t_aaaaaaaa: task is not in an active review run' }
    : runner(command, args);
  calls.length = 0;
  await kanban.comment('SUN-1', { text: 'Concisely, please' });
  assert.deepEqual(calls.slice(1, 3), [['comment', '--author', 'user', 't_aaaaaaaa', 'Concisely, please'], ['reopen-review', 't_aaaaaaaa']]);
});

function contractBoard({ status = 'review', summary = 'Done.', metadata, comments = [], failWith } = {}) {
  const calls = [];
  let current = { status, comments: [...comments] };
  const detail = () => ({ task: { id: 't_aaaaaaaa', title: 'Fix', status: current.status, assignee: 'builder', completion_contract: 'Acme/Site', branch_name: 'wp/t_aaaaaaaa-fix', last_failure_error: current.last || null }, latest_summary: summary, comments: current.comments, events: [{ kind: 'review_requested', payload: { summary, ...(metadata ? { metadata } : {}) } }], parents: [], children: [] });
  const runner = async (_command, args) => {
    const [verb, ...rest] = args.slice(args.indexOf('kanban') + 1).filter((arg) => arg !== '--json');
    calls.push([verb, ...rest]);
    if (verb === 'boards') return { code: 0, stdout: JSON.stringify([{ slug: 'default' }]) };
    if (verb === 'list') return { code: 0, stdout: JSON.stringify([{ id: 't_aaaaaaaa', title: 'Fix', status: current.status, completion_contract: 'Acme/Site' }]) };
    if (verb === 'show') return { code: 0, stdout: JSON.stringify(detail()) };
    if (verb === 'comment') { current.comments.push({ author: rest[1], body: rest[3] }); return { code: 0, stdout: '' }; }
    if (verb === 'reopen-review') { current.status = 'ready'; return { code: 0, stdout: '' }; }
    if (verb === 'complete' && failWith) { current.last = failWith; return { code: 1, stdout: '', stderr: 'completion blocked' }; }
    return { code: 0, stdout: '' };
  };
  return { calls, runner, current };
}

async function contractKanban(options) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-kanban-'));
  const { calls, runner, current } = contractBoard(options);
  const kanban = new KanbanBoard({ config: { dataDir }, hermes: fakeHermes({ runner }), organization: { get: async () => ({ key: 'SUN' }) } });
  return { kanban, calls, current };
}

test('a hand-in on a repo task without its PR is sent back to the seat once', async () => {
  const { kanban, calls } = await contractKanban();
  const { tasks } = await kanban.list();
  assert.equal(tasks[0].status, 'ready');
  const comment = calls.find((call) => call[0] === 'comment');
  assert.equal(comment[2], 'waypoint');
  assert.match(comment[4], /metadata \{"published_pr"/);
  assert.ok(calls.some((call) => call[0] === 'reopen-review'));

  const again = await contractKanban({ comments: [{ author: comment[2], body: comment[4] }] });
  assert.equal((await again.kanban.list()).tasks[0].status, 'review', 'a second hand-in without a PR waits for the user');
  assert.ok(!again.calls.some((call) => call[0] === 'reopen-review'));
});

test('a hand-in with its PR linked stays in review and approval passes the PR', async () => {
  const { kanban, calls } = await contractKanban({ metadata: { published_pr: 'https://github.com/Acme/Site/pull/7' } });
  assert.equal((await kanban.list()).tasks[0].status, 'review');
  const task = await kanban.show('SUN-1');
  assert.equal(task.prLinked, 'https://github.com/Acme/Site/pull/7');
  assert.equal(task.prRepo, 'Acme/Site');
  await kanban.act('SUN-1', { action: 'complete', summary: 'Approved by the user.' });
  const complete = calls.find((call) => call[0] === 'complete');
  assert.deepEqual(JSON.parse(complete[complete.indexOf('--metadata') + 1]), { published_pr: 'https://github.com/Acme/Site/pull/7' });
});

test('approving a repo task without a PR asks the user to pick or paste one', async () => {
  const { kanban, calls } = await contractKanban({ summary: 'Opened https://github.com/acme/site/pull/12 and https://github.com/other/repo/pull/3.', comments: [] });
  kanban.prChecked = new Set(['t_aaaaaaaa']);
  await kanban.list();
  const bare = await contractKanban({ summary: 'Done.' });
  bare.kanban.prChecked = new Set(['t_aaaaaaaa']);
  await bare.kanban.list();
  bare.kanban.github = { repoToken: async () => ({ token: 'x' }), request: async (url) => ({ ok: true, body: url.includes('head=Acme%3Awp%2Ft_aaaaaaaa-fix') ? [{ html_url: 'https://github.com/Acme/Site/pull/21' }, { html_url: 'https://github.com/Acme/Site/pull/22' }] : [] }) };
  await assert.rejects(bare.kanban.act('SUN-1', { action: 'complete' }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'pr_missing');
    assert.match(error.message, /builder didn't link a pull request/);
    assert.deepEqual(error.details, { repo: 'Acme/Site', candidates: ['https://github.com/Acme/Site/pull/21', 'https://github.com/Acme/Site/pull/22'] });
    return true;
  });
  assert.ok(!bare.calls.some((call) => call[0] === 'complete'), 'Hermes is not asked to complete without a PR');

  await assert.rejects(bare.kanban.act('SUN-1', { action: 'complete', pr: 'https://github.com/other/repo/pull/3' }), /pull request URL in Acme\/Site/);
  await bare.kanban.act('SUN-1', { action: 'complete', pr: 'https://github.com/Acme/Site/pull/21' });
  const complete = bare.calls.find((call) => call[0] === 'complete');
  assert.deepEqual(JSON.parse(complete[complete.indexOf('--metadata') + 1]), { published_pr: 'https://github.com/Acme/Site/pull/21' });

  await kanban.act('SUN-1', { action: 'complete' });
  const linked = calls.find((call) => call[0] === 'complete');
  assert.deepEqual(JSON.parse(linked[linked.indexOf('--metadata') + 1]), { published_pr: 'https://github.com/acme/site/pull/12' }, 'a PR in the handoff text is used');
});

test('tasks without a repo contract never need a PR', async () => {
  const { kanban, calls } = await board({ t_aaaaaaaa: 'review' });
  await kanban.list();
  await kanban.act('SUN-1', { action: 'complete' });
  const complete = calls.find((call) => call[0] === 'complete');
  assert.ok(complete && !complete.includes('--metadata'));
  assert.ok(!calls.some((call) => call[0] === 'reopen-review'));
});

test('when GitHub rejects the linked PR, approval asks for the PR instead of failing', async () => {
  const { kanban } = await contractKanban({ metadata: { published_pr: 'https://github.com/Acme/Site/pull/7' }, failWith: 'PR acceptance missing: Supply metadata.published_pr matching the persisted completion contract.' });
  await kanban.list();
  await assert.rejects(kanban.act('SUN-1', { action: 'complete' }), (error) => error.code === 'pr_missing' && /doesn't accept https:\/\/github.com\/Acme\/Site\/pull\/7/.test(error.message));
});

test('a single PR opened from the task branch is linked automatically, with no bounce or picker', async () => {
  const { kanban, calls } = await contractKanban();
  kanban.github = { repoToken: async () => ({ token: 'x' }), request: async () => ({ ok: true, body: [{ html_url: 'https://github.com/Acme/Site/pull/21' }] }) };
  assert.equal((await kanban.list()).tasks[0].status, 'review');
  assert.ok(!calls.some((call) => call[0] === 'reopen-review'));
  const task = await kanban.show('SUN-1');
  assert.equal(task.pullRequest, 'https://github.com/Acme/Site/pull/21');
  assert.equal(task.prLinked, 'https://github.com/Acme/Site/pull/21');
  await kanban.act('SUN-1', { action: 'complete', summary: 'Approved by the user.' });
  const complete = calls.find((call) => call[0] === 'complete');
  assert.deepEqual(JSON.parse(complete[complete.indexOf('--metadata') + 1]), { published_pr: 'https://github.com/Acme/Site/pull/21' });
});

test('every new task needs a project; General covers work without a repository', async () => {
  const { kanban, calls } = await board({});
  withProjects(kanban);
  await assert.rejects(kanban.create({ title: 'Loose end', assignee: 'dev' }), /Pick a project for this task\. Use General/);
  assert.equal(calls.filter((c) => c[0] === 'create').length, 0, 'nothing reaches Hermes without a project');
  await kanban.create({ title: 'Write the brief', assignee: 'dev', project: GENERAL.id });
  await kanban.create({ title: 'Fix the footer', assignee: 'dev', project: SITE.id });
  const creates = calls.filter((c) => c[0] === 'create');
  assert.deepEqual(creates.map((c) => c[c.indexOf('--project') + 1]), ['wp-general', 'wp-site']);
  await assert.rejects(kanban.create({ title: 'x', project: 'project_00000000-0000-4000-8000-00000000ffff' }), /not found/);
});

test('a project-less task can be moved into a project without losing anything', async () => {
  const { kanban, calls } = await board({ t_aaaaaaaa: 'todo' });
  withProjects(kanban);
  const scripts = [];
  kanban.hermes.execPython = async (script, input) => { scripts.push({ script, input: JSON.parse(input) }); return { stdout: '{"ok": true, "worktree": true}\n' }; };
  await kanban.act('t_aaaaaaaa', { action: 'project', project: SITE.id });
  assert.deepEqual(scripts.map((s) => s.input), [{ task: 't_aaaaaaaa', board: 'default', project: 'p_site' }]);
  assert.match(scripts[0].script, /UPDATE tasks SET/);
  assert.doesNotMatch(scripts[0].script, /DELETE/i, 'moving never deletes task data');
  assert.equal(calls.filter((c) => ['archive', 'create'].includes(c[0])).length, 0);
  await assert.rejects(kanban.act('t_aaaaaaaa', { action: 'project' }), /Pick a project/);
  kanban.hermes.execPython = async () => ({ stdout: '{"error": "project_missing"}' });
  await assert.rejects(kanban.act('t_aaaaaaaa', { action: 'project', project: GENERAL.id }), /does not know this project yet/);
});

test('the move script only gives a worktree to tasks that have not started', async () => {
  const { spawnSync } = await import('node:child_process');
  const source = await fs.readFile(new URL('../src/kanban.js', import.meta.url), 'utf8');
  const script = source.match(/const MOVE_TASK_SCRIPT = `([\s\S]*?)`;/)[1];
  assert.match(script, /task\.started_at is None and task\.workspace_kind == 'scratch'/);
  const python = ['python3', 'python'].find((bin) => spawnSync(bin, ['-c', 'pass'], { stdio: 'ignore' }).status === 0);
  if (python) assert.equal(spawnSync(python, ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: script }).status, 0);
});

test('a follow-up task inherits the project of the task it waits on', async () => {
  const { kanban, calls } = await board({ t_aaaaaaaa: 'review' });
  withProjects(kanban);
  await kanban.list();
  await kanban.create({ title: 'Ship the fix', assignee: 'dev', parents: ['SUN-1'] });
  const create = calls.find((c) => c[0] === 'create');
  assert.equal(create[create.indexOf('--project') + 1], 'p_site');
  assert.equal(create[create.indexOf('--parent') + 1], 't_aaaaaaaa');
  calls.length = 0;
  await kanban.create({ title: 'Docs instead', assignee: 'dev', parents: ['SUN-1'], project: GENERAL.id });
  const picked = calls.find((c) => c[0] === 'create');
  assert.equal(picked[picked.indexOf('--project') + 1], 'wp-general', 'an explicit project wins');
});
