import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubConnector, appJwt, inspectLocalPath, normalizeRepo, repoFromRemote } from '../src/github.js';
import { createApp } from '../src/index.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

function fakeGitHub(calls) {
  return async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method || 'GET', path: u.pathname + u.search, auth: init.headers?.authorization || '', body: init.body ? JSON.parse(init.body) : undefined });
    const reply = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
    if (u.pathname === '/app-manifests/goodcode123/conversions') return reply(201, { id: 42, slug: 'waypoint-acme-ab12', name: 'waypoint-acme-ab12', html_url: 'https://github.com/apps/waypoint-acme-ab12', owner: { login: 'acme' }, pem: privateKey, client_id: 'Iv1', client_secret: 'shh', webhook_secret: 'shh2' });
    if (u.pathname === '/app/installations') return reply(200, [{ id: 7, account: { login: 'acme' }, repository_selection: 'selected' }]);
    if (u.pathname === '/app/installations/7/access_tokens') return reply(201, { token: `ghs_token${calls.length}`, expires_at: new Date(Date.now() + 3600e3).toISOString() });
    if (u.pathname === '/installation/repositories') return reply(200, { repositories: [{ full_name: 'acme/site' }] });
    if (u.pathname === '/repos/acme/site/installation') return reply(200, { id: 7 });
    if (u.pathname === '/repos/acme/other/installation') return reply(404, { message: 'Not Found' });
    if (u.pathname === '/repos/acme/site/pulls') return reply(201, { number: 3, title: init.body ? JSON.parse(init.body).title : '' });
    return reply(404, { message: 'Not Found' });
  };
}

async function connector() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-github-'));
  const calls = [];
  return { github: new GitHubConnector({ config: { dataDir }, fetchImpl: fakeGitHub(calls) }), calls, dataDir };
}

test('app JWT is RS256 signed with the app id as issuer', () => {
  const token = appJwt(42, privateKey, 1_700_000_000_000);
  const [head, body, sig] = token.split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${head}.${body}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(sig, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.deepEqual(claims, { iat: 1_699_999_940, exp: 1_700_000_540, iss: '42' });
});

test('repo names and remotes normalize to owner/name', () => {
  assert.equal(normalizeRepo('https://github.com/Acme/Site.git'), 'Acme/Site');
  assert.throws(() => normalizeRepo('acme'), /owner\/name/);
  assert.equal(repoFromRemote('git@github.com:acme/site.git'), 'acme/site');
  assert.equal(repoFromRemote('https://user:tok@github.com/acme/site'), 'acme/site');
  assert.equal(repoFromRemote('https://gitlab.com/acme/site.git'), null);
});

test('manifest flow stores the app privately and lists installations', async () => {
  const { github, calls, dataDir } = await connector();
  assert.equal((await github.status()).connected, false);
  const { state, url, manifest } = github.manifest({ origin: 'http://127.0.0.1:5173/connectors', orgName: 'Acme Robotics' });
  assert.match(url, /^https:\/\/github\.com\/settings\/apps\/new\?state=[0-9a-f]{32}$/);
  assert.match(manifest.name, /^waypoint-acme-robotics-[0-9a-f]{4}$/);
  assert.equal(manifest.redirect_url, 'http://127.0.0.1:5173/connectors/github/callback');
  assert.equal(manifest.default_permissions.contents, 'write');
  assert.ok(github.manifest({ origin: 'http://127.0.0.1:5173', owner: 'acme-org' }).url.startsWith('https://github.com/organizations/acme-org/settings/apps/new?state='));
  assert.throws(() => github.manifest({ origin: 'http://127.0.0.1:5173', owner: 'bad/owner' }), /owner must be/);
  await assert.rejects(github.completeManifest({ code: 'goodcode123', state: 'wrong' }), /expired/);
  const status = await github.completeManifest({ code: 'goodcode123', state });
  assert.equal(status.connected, true);
  assert.equal(status.installUrl, 'https://github.com/apps/waypoint-acme-ab12/installations/new');
  assert.deepEqual(status.installations, [{ id: 7, account: 'acme', selection: 'selected', repos: ['acme/site'] }]);
  const stored = await fs.readFile(path.join(dataDir, 'github', 'app.json'), 'utf8');
  assert.equal(stored.includes('PRIVATE KEY') || stored.includes('shh'), false);
  assert.equal(JSON.stringify(status).includes('PRIVATE KEY'), false);
  await assert.rejects(github.completeManifest({ code: 'goodcode123', state }), /expired/);
  assert.ok(calls.find((c) => c.path === '/app/installations').auth.startsWith('Bearer '));
});

test('repo tokens are scoped to one repository and cached', async () => {
  const { github, calls } = await connector();
  const { state } = github.manifest({ origin: 'http://127.0.0.1:5173' });
  await github.completeManifest({ code: 'goodcode123', state });
  calls.length = 0;
  const first = await github.repoToken('acme/site');
  const second = await github.repoToken('acme/site');
  assert.equal(first.token, second.token);
  assert.deepEqual(calls.filter((c) => c.path.endsWith('/access_tokens')).map((c) => c.body), [{ repositories: ['site'] }]);
  await assert.rejects(github.repoToken('acme/other'), /not installed on acme\/other/);
});

test('local paths detect git repositories and their GitHub remote', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const found = await inspectLocalPath(repoRoot);
  assert.equal(found.isGit, true);
  assert.equal(typeof found.branch, 'string');
  const plain = await inspectLocalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-plain-')));
  assert.deepEqual([plain.exists, plain.isGit, plain.repo], [true, false, null]);
  assert.equal((await inspectLocalPath(path.join(os.tmpdir(), 'missing-waypoint-dir-xyz'))).exists, false);
  await assert.rejects(inspectLocalPath('relative/path'), /absolute/);
});

test('designated seats and the CEO get tokens only for project repositories', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-github-http-'));
  const app = await createApp({ DATA_DIR: dataDir, HERMES_AUTO_START: 'false', LOG_LEVEL: 'error' });
  const calls = [];
  app.github.fetch = fakeGitHub(calls);
  await new Promise((resolve) => app.bridgeServer.listen(0, '127.0.0.1', resolve));
  const bridge = `http://127.0.0.1:${app.bridgeServer.address().port}/bridge/tools`;
  const tool = (token, name, args) => fetch(bridge, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ tool: name, args }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const template = await app.store.createTemplate({ name: 'team', version: '1', seats: [{ id: 'builder', role: 'Builder' }, { id: 'qa', role: 'QA' }] });
    const pod = await app.store.cloneTemplate(template.id, { podName: 'alpha' }, () => ({}));
    await app.store.createProject({ name: 'Site', repo: 'acme/site', githubSeats: [`${pod.id}/builder`] });
    await assert.rejects(app.store.createProject({ name: 'Bad', githubSeats: [`${pod.id}/nobody`] }), /does not belong/);
    const { state } = app.github.manifest({ origin: 'http://127.0.0.1:5173' });
    await app.github.completeManifest({ code: 'goodcode123', state });
    const builder = app.messaging.seatToken(pod.id, 'builder');
    const granted = await tool(builder, 'github_token', { repo: 'ACME/site.git' });
    assert.equal(granted.status, 200);
    assert.match(granted.body.token, /^ghs_/);
    assert.equal(granted.body.repo, 'acme/site');
    assert.equal((await tool(app.messaging.seatToken(pod.id, 'qa'), 'github_token', { repo: 'acme/site' })).status, 403);
    assert.equal((await tool(builder, 'github_token', { repo: 'acme/other' })).status, 403);
    assert.equal((await tool(builder, 'github_token', {})).body.repo, 'acme/site', 'one repository needs no name');
    assert.match((await tool(app.messaging.seatToken(pod.id, 'qa'), 'github_token', {})).body.error.message, /GitHub seats/);
    assert.equal((await tool(builder, 'github_api', { repo: 'acme/site', method: 'GET', path: '/pulls' })).status, 403);
    const ceo = app.config.bridge.token;
    assert.equal((await tool(ceo, 'github_token', { repo: 'acme/site' })).body.repo, 'acme/site');
    await app.store.createProject({ name: 'Docs', repo: 'acme/docs' });
    const ambiguous = await tool(ceo, 'github_token', {});
    assert.equal(ambiguous.status, 400);
    assert.match(ambiguous.body.error.message, /Available: acme\/site, acme\/docs/);
    assert.equal((await tool(ceo, 'github_token', { repo: 'acme/elsewhere' })).status, 403);
  } finally { await new Promise((resolve) => app.bridgeServer.close(resolve)); }
});

test('projects belong to missions and validate the mission', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-project-mission-'));
  const app = await createApp({ DATA_DIR: dataDir, HERMES_AUTO_START: 'false', LOG_LEVEL: 'error' });
  const { mission } = await app.store.createMission({ title: 'Ship v1' }, { source: 'app' });
  const project = await app.store.createProject({ name: 'Goat Ops', missionId: mission.id, repo: 'GoatEXE/goat-ops' });
  assert.equal(project.missionId, mission.id);
  const moved = await app.store.updateProject(project.id, { localPath: 'E:\Repositories\goat-ops' });
  assert.equal(moved.missionId, mission.id);
  assert.equal((await app.store.updateProject(project.id, { missionId: null })).missionId, null);
  await assert.rejects(app.store.createProject({ name: 'Bad', missionId: 'mission_00000000-0000-4000-8000-000000000000' }), /does not match a stored mission/);
  const task = await app.store.createTask({ summary: 'Uses it', projectId: project.id });
  await assert.rejects(app.store.deleteProject(project.id), /1 task uses this project/);
  await app.store.updateTask(task.id, { projectId: null });
  assert.deepEqual(await app.store.deleteProject(project.id), { deleted: true, projectId: project.id });
  assert.deepEqual(await app.store.listProjects(), []);
});
