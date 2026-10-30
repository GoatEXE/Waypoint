import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { HermesRuntime } from '../src/hermes.js';
import { KanbanBoard } from '../src/kanban.js';
import { OrgSeats } from '../src/orgSeats.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waypoint-live-'));
const config = loadConfig({ ...process.env, DATA_DIR: dir, DRY_RUN: 'false' }, dir);
const hermes = new HermesRuntime(config, { info() {}, warn: (...args) => console.warn(...args) });
const started = Date.now();
const step = (name, value) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${name}: ${JSON.stringify(value).slice(0, 300)}`);

try {
  const start = await hermes.start();
  step('start', start.status);
  assert.equal(start.status.running, true);

  const status = await hermes.status({ nativeAuth: 'fresh' });
  step('status', { runtime: status.runtime, configAvailable: status.diagnostics.configAvailable });
  assert.equal(status.diagnostics.configAvailable, true);

  const skills = await hermes.skills();
  const waypoint = skills.skills.filter((skill) => skill.waypoint).map((skill) => skill.name).sort();
  step('skills', { total: skills.counts.total, waypoint });
  assert.deepEqual(waypoint, ['waypoint-ceo-bridge', 'waypoint-onboarding']);

  const board = new KanbanBoard({ config, hermes, organization: { get: async () => ({ key: 'TST' }) } });
  const boards = await board.run(['boards', 'list']);
  step('boards', boards.map((entry) => entry.slug));
  assert.ok(boards.some((entry) => entry.slug === 'default'));

  const seats = new OrgSeats({ config, hermes });
  await seats.hire({ id: 'tester', description: 'Tests things' });
  const listed = await seats.list();
  step('seats', listed.seats);
  assert.ok(listed.seats.some((seat) => seat.id === 'tester'));
  assert.match((await seats.profile('tester')).soul, /tester seat/);

  const env = hermes.host.env();
  const fill = spawnSync('git', ['credential', 'fill'], { env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, input: 'protocol=https\nhost=github.com\npath=octo/repo\n\n', encoding: 'utf8', timeout: 60000 });
  step('git credential', fill.stderr.trim().split('\n')[0]);
  assert.match(fill.stderr, /^Waypoint: /m, 'github.com credentials come only from the Waypoint helper');
  assert.equal(spawnSync('git', ['config', 'user.name'], { env, encoding: 'utf8' }).stdout.trim(), 'ceo (Waypoint)');
  assert.ok(fs.existsSync(path.join(hermes.host.binDir, process.platform === 'win32' ? 'gh.cmd' : 'gh')));

  const stop = await hermes.stop();
  step('stop', stop);
  assert.equal((await hermes.inspect()).state.running, false);
  console.log('live check passed');
} catch (error) {
  await hermes.stop().catch(() => undefined);
  throw error;
} finally {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}
