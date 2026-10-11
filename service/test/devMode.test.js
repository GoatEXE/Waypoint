import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DevMode, githubRepo, prNumberFor } from '../src/devMode.js';

async function setup({ branch = 'main', dirty = '', behind = 'abc1234\tFix things\ndef5678\tAdd stuff', launcher = '1', prFiles = 'app/src/a.tsx' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-dev-'));
  const config = { dataDir: path.join(dir, 'data'), control: { dir: path.join(dir, 'control') } };
  const calls = [];
  const git = async (args) => {
    calls.push(args.join(' '));
    const out = (stdout) => ({ code: 0, stdout, stderr: '' });
    if (args[0] === 'remote') return out('https://github.com/GoatEXE/Waypoint.git\n');
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return out(`${branch}\n`);
    if (args[0] === 'rev-parse' && args[1] === '--short') return out('1111111\n');
    if (args[0] === 'rev-parse' && args[1] === 'FETCH_HEAD') return out('9999999999\n');
    if (args[0] === 'status') return out(dirty);
    if (args[0] === 'log') return out(behind);
    if (args[0] === 'diff') return out(prFiles);
    return out('');
  };
  const dev = new DevMode({ config, git, env: { WAYPOINT_LAUNCHER: launcher } });
  return { dev, config, calls };
}

test('repo and PR numbers parse only for this repository', () => {
  assert.equal(githubRepo('git@github.com:GoatEXE/Waypoint.git'), 'GoatEXE/Waypoint');
  assert.equal(githubRepo('https://github.com/GoatEXE/Waypoint'), 'GoatEXE/Waypoint');
  assert.equal(prNumberFor('https://github.com/goatexe/waypoint/pull/76', 'GoatEXE/Waypoint'), 76);
  assert.equal(prNumberFor('https://github.com/other/repo/pull/1', 'GoatEXE/Waypoint'), null);
});

test('developer mode reports new commits on main and requests an update for the launcher', async () => {
  const { dev, config } = await setup();
  assert.deepEqual(await dev.status(), { enabled: false, launcher: true });
  const status = await dev.setEnabled({ enabled: true });
  assert.equal(status.behind, 2);
  assert.equal(status.canUpdate, true);
  assert.deepEqual(status.commits[0], { sha: 'abc1234', subject: 'Fix things' });
  const request = await dev.requestUpdate();
  const written = JSON.parse(await fs.readFile(path.join(config.control.dir, 'update-request.json'), 'utf8'));
  assert.equal(written.from, '1111111');
  assert.equal(written.requestedAt, request.requestedAt);
});

test('updates are refused off main, with local changes, or without the launcher', async () => {
  for (const [options, reason] of [[{ branch: 'feature/x' }, /not main/], [{ dirty: ' M app/src/a.tsx' }, /uncommitted/], [{ launcher: '' }, /npm start/], [{ behind: '' }, /up to date/]]) {
    const { dev } = await setup(options);
    await dev.setEnabled({ enabled: true });
    await assert.rejects(dev.requestUpdate(), reason);
  }
});

test('a PR that changes the service is not previewed against the live service', async () => {
  const { dev, calls } = await setup({ prFiles: 'app/src/a.tsx\nservice/src/routes.js' });
  await dev.setEnabled({ enabled: true });
  await dev.startPreview({ pr: 12 });
  for (let i = 0; i < 20 && dev.previewStatus().state === 'starting'; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(dev.previewStatus().state, 'needs-service');
  assert.ok(calls.includes('fetch --quiet origin pull/12/head'));
  assert.equal(calls.some((c) => c.startsWith('worktree add')), false);
  await assert.rejects(new DevMode({ config: { dataDir: '/nonexistent-dir', control: { dir: '/x' } }, git: async () => ({ code: 0, stdout: '' }) }).startPreview({ pr: 1 }), /Developer mode is off/);
});
