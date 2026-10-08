import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listFolders } from '../src/folders.js';

test('listFolders shows roots, then sorted visible subfolders with git markers', async () => {
  const top = await listFolders('');
  assert.equal(top.path, null);
  assert.ok(top.entries.some((entry) => entry.name === 'Home'));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-folders-'));
  await fs.mkdir(path.join(dir, 'beta', '.git'), { recursive: true });
  await fs.mkdir(path.join(dir, 'Alpha'));
  await fs.mkdir(path.join(dir, '.hidden'));
  await fs.writeFile(path.join(dir, 'file.txt'), 'x');
  const listed = await listFolders(dir);
  assert.deepEqual(listed.entries.map((e) => [e.name, e.isGit]), [['Alpha', false], ['beta', true]]);
  assert.equal(listed.parent, path.dirname(path.resolve(dir)));
  assert.equal((await listFolders(path.join(dir, 'beta'))).isGit, true);
  await assert.rejects(listFolders('relative'), /absolute/);
  await assert.rejects(listFolders(path.join(dir, 'missing')), /not found/);
});
