import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectSync, hermesSlug, parseProjectId } from '../src/projectSync.js';
import { KanbanBoard } from '../src/kanban.js';
import { loadConfig } from '../src/config.js';

const PROJECT = { id: 'project_1a2b3c4d-0000-4000-8000-000000000000', name: 'Goat Ops', repo: 'goat/ops' };

async function setup({ exists = false } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-projects-'));
  const config = loadConfig({ DATA_DIR: dataDir }, dataDir);
  const calls = [];
  let created = exists;
  const hermes = {
    containerName: 'ceo',
    runner: async (_cmd, args) => {
      const inner = args.slice(4);
      calls.push(inner);
      if (inner[0] === 'hermes' && inner[2] === 'show') return created ? { code: 0, stdout: `${inner[3]}  [p_abc123]\n  primary: /opt/data/repos/goat/ops\n  folders:\n    * /opt/data/repos/goat/ops\n`, stderr: '' } : { code: 1, stdout: '', stderr: 'no such project' };
      if (inner[0] === 'hermes' && inner[2] === 'create') created = true;
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  const store = { listProjects: async () => [PROJECT], getProject: async () => PROJECT };
  return { sync: new ProjectSync({ config, hermes, store }), calls, config, hermes, store };
}

test('a project with a repo is cloned and becomes a Hermes project once', async () => {
  const { sync, calls } = await setup();
  const entry = await sync.ensure(PROJECT);
  assert.deepEqual(entry, { slug: 'wp-1a2b3c4d00', hermesId: 'p_abc123', repo: 'goat/ops' });
  assert.ok(calls[0].join(' ').includes('gh repo clone'));
  assert.ok(calls.some((c) => c.join(' ') === 'hermes project create Goat Ops /opt/data/repos/goat/ops --slug wp-1a2b3c4d00'));
  const before = calls.length;
  await sync.ensure(PROJECT);
  assert.equal(calls.length, before);
  assert.deepEqual(await sync.byHermesId(), { p_abc123: PROJECT.id });
  assert.equal(await sync.ensure({ ...PROJECT, repo: null }), null);
});

test('slugs and ids parse predictably', () => {
  assert.equal(hermesSlug(PROJECT.id), 'wp-1a2b3c4d00');
  assert.equal(parseProjectId('demo  [p_7b2f854a]\n  name: Demo'), 'p_7b2f854a');
});

test('tasks created with a project pass its Hermes slug and show the Waypoint project', async () => {
  const { sync, config, hermes, store } = await setup({ exists: true });
  const runs = [];
  const board = new KanbanBoard({ config, hermes, organization: null });
  board.projects = sync;
  board.store = store;
  board.run = async (args) => { runs.push(args); return args[0] === 'create' ? { id: 't_aaaaaa' } : null; };
  board.numberAll = async () => ({});
  board.show = async () => ({ id: 't_aaaaaa' });
  await board.create({ title: 'Ship it', project: PROJECT.id });
  const create = runs.find((args) => args[0] === 'create');
  assert.equal(create[create.indexOf('--project') + 1], 'wp-1a2b3c4d00');
  const summary = board.summary({ id: 't_aaaaaa', title: 'x', status: 'todo', project_id: 'p_abc123' }, {}, 'WP', 'default', await board.projectMap());
  assert.equal(summary.projectId, PROJECT.id);
});
