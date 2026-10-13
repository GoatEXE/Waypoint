import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { HermesRuntime } from '../src/hermes.js';
import { loadConfig } from '../src/config.js';
import { SEED_USER_SCRIPT, USER_ABOUT_MAX, UserStore, seedCeoUserProfile, userSeedEntries } from '../src/user.js';

async function tempUsers() {
  return new UserStore(await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-user-')));
}

function fakeHermes(stdout = '{"ok": true}\n') {
  const calls = [];
  return { calls, execPython: async (script, input) => { calls.push({ script, input: JSON.parse(input) }); return { code: 0, stdout, stderr: '' }; } };
}

test('user profile requires a name and keeps about optional', async () => {
  const users = await tempUsers();
  assert.deepEqual(await users.describe(), { configured: false, user: null });
  await assert.rejects(users.update({ about: 'hi' }), /name is required/);
  await assert.rejects(users.update({ name: '   ' }), /name must be/);
  await assert.rejects(users.update({ name: 'Ada', about: 'x'.repeat(USER_ABOUT_MAX + 1) }), /about must be/);
  await assert.rejects(users.update({ name: 'Ada', email: 'a@b' }), /unsupported user fields/);
  const user = await users.update({ name: '  Ada   Lovelace ' });
  assert.equal(user.name, 'Ada Lovelace');
  assert.equal(user.about, '');
  assert.deepEqual(user.seed, { state: 'pending' });
  assert.equal((await users.describe()).configured, true);
});

test('seed entries carry the name and the optional about sentence', () => {
  assert.deepEqual(userSeedEntries({ name: 'Ada' }), ["The user's name is Ada."]);
  assert.deepEqual(userSeedEntries({ name: 'Ada', about: 'I build robots.' }), ["The user's name is Ada.", 'In their own words: I build robots.']);
});

test('seeding writes USER.md through Hermes memory once', async () => {
  const users = await tempUsers();
  await users.update({ name: 'Ada', about: 'I build robots.' });
  const hermes = fakeHermes();
  const seeded = await seedCeoUserProfile(hermes, users);
  assert.equal(seeded.seed.state, 'done');
  assert.equal(hermes.calls.length, 1);
  assert.equal(hermes.calls[0].script, SEED_USER_SCRIPT);
  assert.match(SEED_USER_SCRIPT, /load_on_disk_store/);
  assert.match(SEED_USER_SCRIPT, /apply_batch\('user'/);
  assert.deepEqual(hermes.calls[0].input.entries, ["The user's name is Ada.", 'In their own words: I build robots.']);
  await seedCeoUserProfile(hermes, users);
  assert.equal(hermes.calls.length, 1);
  assert.equal((await users.update({ about: 'Changed.' })).seed.state, 'done');
});

test('seeding records a Hermes refusal and stays pending when the CEO is unreachable', async () => {
  const users = await tempUsers();
  await users.update({ name: 'Ada' });
  const refused = await seedCeoUserProfile(fakeHermes('{"ok": false, "error": "Memory at 1,375/1,375 chars"}\n'), users);
  assert.equal(refused.seed.state, 'failed');
  assert.match(refused.seed.error, /1,375/);

  const other = await tempUsers();
  await other.update({ name: 'Ada' });
  const offline = { execPython: async () => { throw new Error('container stopped'); } };
  assert.equal((await seedCeoUserProfile(offline, other)).seed.state, 'pending');
});

test('preparing the CEO home seeds a pending user profile', async () => {
  const users = await tempUsers();
  await users.update({ name: 'Ada' });
  const scripts = [];
  const runner = async (_command, args) => {
    if (args[0] === 'exec' && args.includes('python3')) { scripts.push(String(args.at(-1))); return { code: 0, stdout: '{"ok": true}\n', stderr: '' }; }
    return { code: 0, stdout: 'approve\n', stderr: '' };
  };
  const hermes = new HermesRuntime(loadConfig({}, '/tmp'), undefined, runner);
  hermes.users = users;
  await hermes.prepareCeoHome();
  assert.ok(scripts.includes(SEED_USER_SCRIPT));
  assert.equal((await users.get()).seed.state, 'done');
});

test('user routes save and validate the profile', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-user-http-'));
  const app = await createApp({ DATA_DIR: dataDir, WAYPOINT_CONTROL_DIR: path.join(dataDir, 'control'), LOG_LEVEL: 'error', HERMES_AUTO_START: 'false' });
  app.hermes.seedUserProfile = async () => null;
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const put = (body) => fetch(`${base}/user`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await fetch(`${base}/user`).then((r) => r.json()), { configured: false, user: null });
    assert.equal((await put({ about: 'no name' })).status, 400);
    const saved = await put({ name: 'Ada', about: 'I build robots.' });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.configured, true);
    assert.equal(body.user.name, 'Ada');
    assert.equal((await fetch(`${base}/user`).then((r) => r.json())).user.about, 'I build robots.');
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
});
