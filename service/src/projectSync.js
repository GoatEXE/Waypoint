import fs from 'node:fs/promises';
import path from 'node:path';
import { lifecycleError, runtimeFailure } from './errors.js';

const REPOS_ROOT = '/opt/data/repos';

export function hermesSlug(projectId) {
  const hex = String(projectId || '').replace(/^project_/, '').replace(/[^0-9a-f]/g, '').slice(0, 10);
  return `wp-${hex}`;
}

export function repoPath(repo) {
  return `${REPOS_ROOT}/${repo}`;
}

export function parseProjectId(text) {
  return String(text || '').match(/\[(p_[0-9a-f]+)\]/)?.[1] || null;
}

export class ProjectSync {
  constructor({ config, hermes, store, logger }) {
    this.config = config;
    this.hermes = hermes;
    this.store = store;
    this.logger = logger;
    this.file = path.join(config.dataDir, 'hermes-projects.json');
    this.pending = new Map();
  }

  async read() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }

  async exec(args, timeoutMs = 120000) {
    const result = await this.hermes.runner('docker', ['exec', '--user', 'hermes', this.hermes.containerName, ...args], { timeoutMs, outputLimitBytes: 64 * 1024 });
    if (result.code !== 0) throw runtimeFailure(result) || lifecycleError(`${args.slice(0, 3).join(' ')} failed`, { code: result.code });
    return String(result.stdout || '');
  }

  ensure(project) {
    if (!project?.repo) return Promise.resolve(null);
    const key = `${project.id}:${project.repo}`;
    if (!this.pending.has(key)) this.pending.set(key, this.#ensure(project).finally(() => this.pending.delete(key)));
    return this.pending.get(key);
  }

  async #ensure(project) {
    const slug = hermesSlug(project.id);
    const known = (await this.read())[project.id];
    if (known?.repo === project.repo && known.hermesId) return known;
    const folder = repoPath(project.repo);
    await this.exec(['sh', '-c', 'test -d "$1/.git" || gh repo clone "$2" "$1" -- --quiet', 'sh', folder, project.repo], 300000);
    let shown = await this.exec(['hermes', 'project', 'show', slug]).catch(() => '');
    if (!shown) {
      await this.exec(['hermes', 'project', 'create', project.name, folder, '--slug', slug]);
      shown = await this.exec(['hermes', 'project', 'show', slug]);
    } else if (!shown.includes(folder)) {
      await this.exec(['hermes', 'project', 'add-folder', slug, folder]);
      await this.exec(['hermes', 'project', 'set-primary', slug, folder]);
    }
    const hermesId = parseProjectId(shown);
    if (!hermesId) throw lifecycleError('Hermes did not report a project id');
    const entry = { slug, hermesId, repo: project.repo };
    const all = await this.read();
    all[project.id] = entry;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`);
    this.logger?.info?.('hermes_project_synced', { slug });
    return entry;
  }

  sync(project) {
    void this.ensure(project).catch((error) => this.logger?.warn?.('hermes_project_sync_failed', { message: error.message }));
  }

  async syncAll() {
    for (const project of await this.store.listProjects()) if (project.repo) await this.ensure(project).catch((error) => this.logger?.warn?.('hermes_project_sync_failed', { message: error.message }));
  }

  async byHermesId() {
    return Object.fromEntries(Object.entries(await this.read()).map(([projectId, entry]) => [entry.hermesId, projectId]));
  }

  async slugs() {
    return Object.fromEntries(Object.entries(await this.read()).map(([projectId, entry]) => [projectId, entry.slug]));
  }
}
