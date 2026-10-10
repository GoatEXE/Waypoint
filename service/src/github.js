import { createSign, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, badRequest, conflict, forbidden } from './errors.js';

const API = 'https://api.github.com';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const CODE_RE = /^[A-Za-z0-9_-]{8,200}$/;
const STATE_TTL_MS = 30 * 60 * 1000;
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
export const GITHUB_PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read', checks: 'read', actions: 'read' };

export function normalizeRepo(value) {
  const repo = String(value || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  if (!REPO_RE.test(repo)) throw badRequest('repo must be owner/name');
  return repo;
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
    this.statusCache = null;
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
    return this.status({ fresh: true });
  }

  async jwt() {
    const app = await this.app();
    if (!app) throw conflict('GitHub is not connected');
    return appJwt(app.appId, await fs.readFile(this.keyPath(), 'utf8'), this.now());
  }

  async status({ fresh = false } = {}) {
    if (!fresh && this.statusCache && this.statusCache.until > this.now()) return this.statusCache.value;
    const value = await this.loadStatus();
    this.statusCache = { value, until: this.now() + 60000 };
    return value;
  }

  async loadStatus() {
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
    this.statusCache = null;
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
}
