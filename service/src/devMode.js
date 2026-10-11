import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { badRequest, conflict, lifecycleError } from './errors.js';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const UPDATE_REQUEST = 'update-request.json';
export const UPDATE_RESULT = 'update-result.json';
const PREVIEW_PORT = 5174;
const FETCH_TTL_MS = 60000;

export function githubRepo(remoteUrl) {
  const match = String(remoteUrl || '').trim().match(/github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return match ? match[1] : null;
}

export function prNumberFor(url, repo) {
  const match = String(url || '').match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)/);
  if (!match || !repo || match[1].toLowerCase() !== repo.toLowerCase()) return null;
  return Number(match[2]);
}

export function needsService(files) {
  return files.filter((file) => file.startsWith('service/'));
}

function defaultGit(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export class DevMode {
  constructor({ config, logger, git = defaultGit, spawner = spawn, root = REPO_ROOT, env = process.env }) {
    this.config = config;
    this.logger = logger;
    this.gitRunner = git;
    this.spawner = spawner;
    this.root = root;
    this.env = env;
    this.file = path.join(config.dataDir, 'dev-mode.json');
    this.fetchedAt = 0;
    this.preview = null;
  }

  async git(args, cwd = this.root) {
    const result = await this.gitRunner(args, cwd);
    if (result.code !== 0) throw lifecycleError(`git ${args[0]} failed${result.stderr ? `: ${result.stderr.trim().split('\n').pop().slice(0, 200)}` : ''}`);
    return result.stdout.trim();
  }

  async enabled() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')).enabled === true; }
    catch { return false; }
  }

  async setEnabled(input = {}) {
    if (typeof input?.enabled !== 'boolean') throw badRequest('enabled must be a boolean');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify({ enabled: input.enabled })}\n`);
    if (!input.enabled) await this.stopPreview().catch(() => undefined);
    return this.status();
  }

  async lastUpdate() {
    try { return JSON.parse(await fs.readFile(path.join(this.config.control.dir, UPDATE_RESULT), 'utf8')); }
    catch { return null; }
  }

  async status({ refresh = false } = {}) {
    const enabled = await this.enabled();
    const launcher = this.env.WAYPOINT_LAUNCHER === '1';
    if (!enabled) return { enabled, launcher };
    const repo = githubRepo(await this.git(['remote', 'get-url', 'origin']).catch(() => ''));
    const branch = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const dirty = (await this.git(['status', '--porcelain', '--untracked-files=no'])).length > 0;
    let fetchError = null;
    if (refresh || Date.now() - this.fetchedAt > FETCH_TTL_MS) {
      try { await this.git(['fetch', '--quiet', 'origin', 'main']); this.fetchedAt = Date.now(); }
      catch (error) { fetchError = error.message; }
    }
    const head = await this.git(['rev-parse', '--short', 'HEAD']);
    const log = await this.git(['log', '--format=%h%x09%s', '-n', '20', 'HEAD..origin/main']).catch(() => '');
    const commits = log ? log.split('\n').map((line) => { const [sha, ...rest] = line.split('\t'); return { sha, subject: rest.join('\t') }; }) : [];
    const blockers = [
      !launcher && 'Start Waypoint with npm start from the repository root to update in place.',
      branch !== 'main' && `The checkout is on ${branch}, not main.`,
      dirty && 'The checkout has uncommitted changes.',
    ].filter(Boolean);
    return { enabled, launcher, repo, branch, head, dirty, commits, behind: commits.length, canUpdate: commits.length > 0 && !blockers.length, blockers, fetchError, lastUpdate: await this.lastUpdate(), preview: this.previewStatus() };
  }

  async requestUpdate() {
    const status = await this.status({ refresh: true });
    if (!status.enabled) throw conflict('Developer mode is off.');
    if (status.blockers.length) throw conflict(status.blockers[0]);
    if (!status.behind) throw conflict('Waypoint is already up to date.');
    await fs.mkdir(this.config.control.dir, { recursive: true });
    const requestedAt = new Date().toISOString();
    await fs.writeFile(path.join(this.config.control.dir, UPDATE_REQUEST), `${JSON.stringify({ requestedAt, from: status.head })}\n`);
    this.logger?.info?.('update_requested', { from: status.head, behind: status.behind });
    return { requested: true, from: status.head, requestedAt };
  }

  previewStatus() {
    if (!this.preview) return null;
    const { pr, state, url, files, error, sha } = this.preview;
    return { pr, state, url, files, error, sha };
  }

  async startPreview(input = {}) {
    if (!(await this.enabled())) throw conflict('Developer mode is off.');
    const pr = Number(input?.pr);
    if (!Number.isInteger(pr) || pr < 1) throw badRequest('pr must be a pull request number');
    if (this.preview?.pr === pr && ['running', 'starting'].includes(this.preview.state)) return this.previewStatus();
    await this.stopPreview();
    this.preview = { pr, state: 'starting', url: null, files: [], error: null, sha: null, child: null, dir: null };
    void this.#launchPreview(pr).catch((error) => {
      if (this.preview?.pr !== pr) return;
      this.preview.state = 'failed';
      this.preview.error = error.message;
      this.logger?.warn?.('preview_failed', { pr, message: error.message });
    });
    return this.previewStatus();
  }

  async #launchPreview(pr) {
    await this.git(['fetch', '--quiet', 'origin', `pull/${pr}/head`]);
    const sha = await this.git(['rev-parse', 'FETCH_HEAD']);
    const files = (await this.git(['diff', '--name-only', `HEAD...${sha}`])).split('\n').filter(Boolean);
    Object.assign(this.preview, { sha: sha.slice(0, 7), files });
    if (needsService(files).length) { this.preview.state = 'needs-service'; return; }
    const dir = path.join(this.root, '.previews', `pr-${pr}`);
    this.preview.dir = dir;
    await this.#removeWorktree(dir);
    await this.git(['worktree', 'add', '--detach', dir, sha]);
    const sameDeps = (await this.gitRunner(['diff', '--quiet', 'HEAD', sha, '--', 'app/package-lock.json'], this.root)).code === 0;
    const modules = path.join(dir, 'app', 'node_modules');
    if (sameDeps) await fs.symlink(path.join(this.root, 'app', 'node_modules'), modules, 'junction');
    else await this.#run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], path.join(dir, 'app'));
    if (this.preview?.pr !== pr) return;
    const vite = path.join(modules, 'vite', 'bin', 'vite.js');
    const child = this.spawner(process.execPath, [vite, '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: path.join(dir, 'app'), env: { ...this.env, WAYPOINT_CONTROL_DIR: this.config.control.dir }, stdio: 'ignore', windowsHide: true });
    this.preview.child = child;
    child.on('exit', () => { if (this.preview?.child === child && this.preview.state !== 'stopped') { this.preview.state = 'failed'; this.preview.error = this.preview.error || 'The preview app stopped.'; } });
    const url = `http://127.0.0.1:${PREVIEW_PORT}`;
    for (let i = 0; i < 60; i += 1) {
      if (await fetch(url, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)) {
        if (this.preview?.child === child) Object.assign(this.preview, { state: 'running', url });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw lifecycleError(`The preview app did not answer on port ${PREVIEW_PORT}.`);
  }

  #run(command, args, cwd) {
    return new Promise((resolve, reject) => {
      const child = this.spawner(command, args, { cwd, stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(lifecycleError(`${command} ${args[0]} failed with exit ${code}`))));
    });
  }

  async #removeWorktree(dir) {
    const modules = path.join(dir, 'app', 'node_modules');
    const stat = await fs.lstat(modules).catch(() => null);
    if (stat?.isSymbolicLink()) await fs.unlink(modules).catch(() => fs.rmdir(modules));
    await this.gitRunner(['worktree', 'remove', '--force', dir], this.root);
    await this.gitRunner(['worktree', 'prune'], this.root);
  }

  async stopPreview() {
    const current = this.preview;
    if (!current) return { stopped: true };
    current.state = 'stopped';
    current.child?.kill();
    this.preview = null;
    if (current.dir) await this.#removeWorktree(current.dir);
    return { stopped: true };
  }

  close() {
    this.preview?.child?.kill();
  }
}
