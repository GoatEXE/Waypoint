import { createSign, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, badRequest, conflict, forbidden } from './errors.js';

const API = 'https://api.github.com';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const CODE_RE = /^[A-Za-z0-9_-]{8,200}$/;
const STATE_TTL_MS = 30 * 60 * 1000;
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const API_BODY_MAX = 200000;
const API_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
const BLOCKED_API_PATHS = [/^\/(hooks|keys|collaborators|invitations|actions\/secrets|actions\/variables|environments|rulesets|branches\/[^/]+\/protection|transfer|dependabot\/secrets|codespaces\/secrets)(\/|$)/];
export const GITHUB_PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read', checks: 'read', actions: 'read' };

export function normalizeRepo(value) {
  const repo = String(value || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  if (!REPO_RE.test(repo)) throw badRequest('repo must be owner/name');
  return repo;
}

export function repoFromRemote(remote) {
  const match = String(remote || '').trim().match(/^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  return match ? match[1] : null;
}

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function appJwt(appId, privateKey, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${base64url(signer.sign(privateKey))}`;
}

function runGit(args) {
  return new Promise((resolve) => {
    execFile('git', args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).trim()));
  });
}

export async function inspectLocalPath(input) {
  const dir = String(input || '').trim();
  if (!dir || dir.length > 1000 || !path.isAbsolute(dir)) throw badRequest('localPath must be an absolute folder path');
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return { localPath: dir, exists: false, isGit: false, root: null, remote: null, repo: null, branch: null };
  const root = await runGit(['-C', dir, 'rev-parse', '--show-toplevel']);
  if (!root) return { localPath: dir, exists: true, isGit: false, root: null, remote: null, repo: null, branch: null };
  const remote = await runGit(['-C', dir, 'remote', 'get-url', 'origin']);
  const branch = await runGit(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const safeRemote = remote ? remote.replace(/\/\/[^@/]+@/, '//') : null;
  return { localPath: dir, exists: true, isGit: true, root: path.normalize(root), remote: safeRemote, repo: repoFromRemote(remote), branch };
}

function githubError(status, body, fallback) {
  const message = typeof body?.message === 'string' ? body.message.slice(0, 200) : fallback;
  return new AppError(status === 404 ? 404 : status === 401 || status === 403 ? 403 : 502, 'github_error', `GitHub: ${message}`);
}

export class GitHubConnector {
  constructor({ config, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.dir = path.join(config.dataDir, 'github');
    this.fetch = fetchImpl;
    this.now = now;
    this.states = new Map();
    this.tokens = new Map();
  }

  appPath() { return path.join(this.dir, 'app.json'); }
  keyPath() { return path.join(this.dir, 'private-key.pem'); }

  async app() {
    try { return JSON.parse(await fs.readFile(this.appPath(), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async request(url, { method = 'GET', token, jwt, body } = {}) {
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'waypoint' };
    if (token) headers.authorization = `token ${token}`;
    if (jwt) headers.authorization = `Bearer ${jwt}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.fetch(`${API}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text.slice(0, API_BODY_MAX); }
    return { status: response.status, ok: response.ok, body: parsed };
  }

  manifest({ origin, orgName = 'Waypoint', owner = '' }) {
    let base;
    try { base = new URL(String(origin || '')); } catch { throw badRequest('origin must be the app URL'); }
    if (!['http:', 'https:'].includes(base.protocol)) throw badRequest('origin must be http or https');
    const account = String(owner || '').trim();
    if (account && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(account)) throw badRequest('owner must be a GitHub organization login');
    for (const [state, expires] of this.states) if (expires < this.now()) this.states.delete(state);
    const state = randomBytes(16).toString('hex');
    this.states.set(state, this.now() + STATE_TTL_MS);
    const slug = String(orgName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'org';
    return {
      state,
      url: account ? `https://github.com/organizations/${account}/settings/apps/new?state=${state}` : `https://github.com/settings/apps/new?state=${state}`,
      manifest: {
        name: `waypoint-${slug}-${randomBytes(2).toString('hex')}`,
        url: base.origin,
        redirect_url: `${base.origin}/connectors/github/callback`,
        setup_url: `${base.origin}/connectors/github/installed`,
        setup_on_update: true,
        public: false,
        default_permissions: GITHUB_PERMISSIONS,
        default_events: [],
      },
    };
  }

  async completeManifest({ code, state } = {}) {
    const expires = this.states.get(String(state || ''));
    if (!expires || expires < this.now()) throw badRequest('GitHub setup link expired; start again from Connectors');
    if (!CODE_RE.test(String(code || ''))) throw badRequest('invalid GitHub setup code');
    this.states.delete(String(state));
    const result = await this.request(`/app-manifests/${code}/conversions`, { method: 'POST' });
    if (!result.ok || !result.body?.id || typeof result.body.pem !== 'string') throw githubError(result.status, result.body, 'app creation could not be confirmed');
    const { id, slug, name, html_url: htmlUrl, owner, pem, client_id: clientId } = result.body;
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.keyPath(), pem, { mode: 0o600 });
    const app = { appId: id, slug, name, htmlUrl, clientId, owner: owner?.login || null, createdAt: new Date(this.now()).toISOString() };
    await fs.writeFile(this.appPath(), JSON.stringify(app, null, 2), { mode: 0o600 });
    this.tokens.clear();
    return this.status();
  }

  async jwt() {
    const app = await this.app();
    if (!app) throw conflict('GitHub is not connected');
    return appJwt(app.appId, await fs.readFile(this.keyPath(), 'utf8'), this.now());
  }

  async status() {
    const app = await this.app();
    if (!app) return { connected: false, app: null, installUrl: null, installations: [] };
    const installUrl = `https://github.com/apps/${app.slug}/installations/new`;
    let installations = [];
    let error = null;
    try {
      const listed = await this.request('/app/installations', { jwt: await this.jwt() });
      if (!listed.ok) throw githubError(listed.status, listed.body, 'installations could not be listed');
      for (const item of listed.body || []) {
        const token = await this.installationToken(item.id);
        const repos = await this.request('/installation/repositories?per_page=100', { token: token.token });
        installations.push({ id: item.id, account: item.account?.login || '', selection: item.repository_selection, repos: repos.ok ? (repos.body.repositories || []).map((repo) => repo.full_name) : [] });
      }
    } catch (caught) { error = caught.message; installations = []; }
    return { connected: true, app: { appId: app.appId, slug: app.slug, name: app.name, htmlUrl: app.htmlUrl, owner: app.owner }, installUrl, installations, error };
  }

  async disconnect() {
    await fs.rm(this.dir, { recursive: true, force: true });
    this.tokens.clear();
    return { connected: false };
  }

  async installationToken(installationId, repoName) {
    const result = await this.request(`/app/installations/${installationId}/access_tokens`, { method: 'POST', jwt: await this.jwt(), body: repoName ? { repositories: [repoName] } : {} });
    if (!result.ok || typeof result.body?.token !== 'string') throw githubError(result.status, result.body, 'token could not be issued');
    return { token: result.body.token, expiresAt: result.body.expires_at };
  }

  async repoToken(repoInput) {
    const repo = normalizeRepo(repoInput);
    const cached = this.tokens.get(repo);
    if (cached && Date.parse(cached.expiresAt) - TOKEN_MARGIN_MS > this.now()) return { repo, ...cached };
    const install = await this.request(`/repos/${repo}/installation`, { jwt: await this.jwt() });
    if (!install.ok || !install.body?.id) throw forbidden(`The Waypoint GitHub App is not installed on ${repo}`);
    const issued = await this.installationToken(install.body.id, repo.split('/')[1]);
    this.tokens.set(repo, issued);
    return { repo, ...issued };
  }

  async api(repoInput, { method = 'GET', path: apiPath = '', body } = {}) {
    const repo = normalizeRepo(repoInput);
    const verb = String(method).toUpperCase();
    if (!API_METHODS.has(verb)) throw badRequest('method must be GET, POST, PATCH, PUT, or DELETE');
    const sub = String(apiPath || '');
    if (sub && !sub.startsWith('/')) throw badRequest('path must start with / and is relative to the repository');
    if (sub.includes('..') || /[\s?#]/.test(sub.split('?')[0]) || sub.length > 300) throw badRequest('invalid GitHub API path');
    const bare = sub.split('?')[0];
    if (BLOCKED_API_PATHS.some((re) => re.test(bare))) throw forbidden('That GitHub API area is reserved for the repository owner');
    if (!bare && verb !== 'GET') throw forbidden('Repository settings cannot be changed through Waypoint');
    const { token } = await this.repoToken(repo);
    const result = await this.request(`/repos/${repo}${sub}`, { method: verb, token, body });
    const serialized = JSON.stringify(result.body ?? null);
    return { status: result.status, body: serialized.length > API_BODY_MAX ? { truncated: true, preview: serialized.slice(0, API_BODY_MAX) } : result.body };
  }
}

export const SEAT_GITHUB_CLIENT = String.raw`#!/usr/bin/env python3
import json, pathlib, subprocess, sys, urllib.request, urllib.error

me = pathlib.Path(__file__).resolve()
home = me.parents[1]
seat = home.name
config = json.loads((home / 'waypoint' / 'messaging.json').read_text(encoding='utf-8'))
usage = 'usage: waypoint-github.py clone OWNER/REPO [DIR] | api OWNER/REPO METHOD PATH [--data JSON] | credential get'

def call(tool, args):
    request = urllib.request.Request(config['baseUrl'], data=json.dumps({'tool': tool, 'args': args}).encode('utf-8'), headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        print(json.dumps(json.load(error), ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)

helper = '!python3 ' + str(me) + ' credential'
if len(sys.argv) < 2:
    raise SystemExit(usage)
action = sys.argv[1]
if action == 'credential':
    if len(sys.argv) < 3 or sys.argv[2] != 'get':
        raise SystemExit(0)
    fields = dict(line.split('=', 1) for line in sys.stdin.read().splitlines() if '=' in line)
    if fields.get('host') != 'github.com' or not fields.get('path'):
        raise SystemExit(0)
    repo = fields['path'].strip('/').removesuffix('.git')
    result = call('github_token', {'repo': repo})
    print('username=x-access-token')
    print('password=' + result['token'])
elif action == 'clone' and len(sys.argv) in (3, 4):
    repo = sys.argv[2].strip('/').removesuffix('.git')
    target = sys.argv[3] if len(sys.argv) == 4 else repo.split('/')[-1]
    settings = ['-c', 'credential.helper=', '-c', 'credential.helper=' + helper, '-c', 'credential.useHttpPath=true']
    code = subprocess.call(['git'] + settings + ['clone', 'https://github.com/' + repo + '.git', target])
    if code:
        raise SystemExit(code)
    for key, value in (('credential.helper', helper), ('credential.useHttpPath', 'true'), ('user.name', seat + ' (Waypoint)'), ('user.email', seat + '@waypoint.local')):
        subprocess.check_call(['git', '-C', target, 'config', key, value])
    print(json.dumps({'cloned': repo, 'path': str(pathlib.Path(target).resolve())}))
elif action == 'api' and len(sys.argv) in (5, 7):
    args = {'repo': sys.argv[2], 'method': sys.argv[3], 'path': sys.argv[4]}
    if len(sys.argv) == 7:
        if sys.argv[5] != '--data':
            raise SystemExit(usage)
        args['body'] = json.loads(sys.argv[6])
    print(json.dumps(call('github_api', args), ensure_ascii=False))
else:
    raise SystemExit(usage)
`;

export function seatGithubSkill(seatId) {
  const client = `/opt/data/profiles/${seatId}/bin/waypoint-github.py`;
  return `---\nname: waypoint-github\ndescription: Clone, commit, push, and open or merge pull requests on GitHub repositories this seat is designated for in Waypoint.\n---\n\n# Waypoint GitHub\n\nYou can use GitHub only for repositories whose Waypoint project designates this seat. Waypoint issues short-lived tokens through the Waypoint GitHub App; never print, store, or paste a token.\n\n- Clone into your task workspace: \`python3 ${client} clone OWNER/REPO\`. The clone is set up so \`git pull\` and \`git push\` authenticate automatically and commits use your seat name.\n- Work on a branch: \`git checkout -b seat/short-topic\`, commit, then \`git push -u origin HEAD\`. Do not push to the default branch unless the user asked.\n- GitHub API, relative to the repository: \`python3 ${client} api OWNER/REPO METHOD PATH [--data JSON]\`.\n  - Open a pull request: \`api OWNER/REPO POST /pulls --data '{"title":"...","head":"seat/short-topic","base":"main","body":"..."}'\`\n  - List pull requests: \`api OWNER/REPO GET /pulls\`; comment on an issue or PR: \`POST /issues/NUMBER/comments\`.\n  - Merge only when the user asked: \`api OWNER/REPO PUT /pulls/NUMBER/merge --data '{"merge_method":"squash"}'\`.\n\nRepository settings, webhooks, collaborators, secrets, and branch protection are reserved for the owner. If access is refused, report it rather than working around it.\n`;
}
