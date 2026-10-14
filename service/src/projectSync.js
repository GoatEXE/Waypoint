import fs from 'node:fs/promises';
import path from 'node:path';
import { lifecycleError, runtimeFailure } from './errors.js';

const REPOS_ROOT = '/opt/data/repos';

const SCOPE_BOARD_SCRIPT = `import sys
from hermes_cli import kanban_db as kb
if not (kb.read_board_metadata(sys.argv[1]).get('project_id') or '').strip():
    kb.write_board_metadata(sys.argv[1], project_id=sys.argv[2])`;

const MIRROR_SCRIPT = `import os, sys
from pathlib import Path
from hermes_cli import projects_db as pdb
with pdb.connect_closing() as src:
    projects = [dict(r) for r in src.execute("SELECT * FROM projects WHERE slug LIKE 'wp-%'")]
    folders = [dict(r) for r in src.execute("SELECT f.* FROM project_folders f JOIN projects p ON p.id = f.project_id WHERE p.slug LIKE 'wp-%'")]
root = Path('/opt/data/profiles')
for home in sorted(root.iterdir()) if root.is_dir() else []:
    if not home.is_dir() or not (home / 'config.yaml').exists():
        continue
    with pdb.connect_closing(db_path=home / 'projects.db') as dst:
        with pdb.write_txn(dst):
            for row in projects:
                if dst.execute('SELECT 1 FROM projects WHERE slug = ? AND id != ?', (row['slug'], row['id'])).fetchone():
                    continue
                cols = [c for c in row if c in {r[1] for r in dst.execute('PRAGMA table_info(projects)')}]
                dst.execute('INSERT OR REPLACE INTO projects (' + ', '.join(cols) + ') VALUES (' + ', '.join('?' for _ in cols) + ')', [row[c] for c in cols])
            for row in folders:
                dst.execute('INSERT OR IGNORE INTO project_folders (project_id, path, label, is_primary, added_at) VALUES (?, ?, ?, ?, ?)', (row['project_id'], row['path'], row['label'], row['is_primary'], row['added_at']))`;

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
    if (!project?.id) return Promise.resolve(null);
    const key = `${project.id}:${project.repo}`;
    if (!this.pending.has(key)) this.pending.set(key, this.#ensure(project).finally(() => this.pending.delete(key)));
    return this.pending.get(key);
  }

  async #ensure(project) {
    const slug = hermesSlug(project.id);
    const known = (await this.read())[project.id];
    if (known?.repo === project.repo && known.hermesId) return known;
    const folder = project.repo ? repoPath(project.repo) : null;
    if (folder) await this.exec(['sh', '-c', 'test -d "$1/.git" || gh repo clone "$2" "$1" -- --quiet', 'sh', folder, project.repo], 300000);
    let shown = await this.exec(['hermes', 'project', 'show', slug]).catch(() => '');
    if (!shown) {
      await this.exec(['hermes', 'project', 'create', project.name, ...(folder ? [folder] : []), '--slug', slug]);
      shown = await this.exec(['hermes', 'project', 'show', slug]);
    } else if (folder && !shown.includes(folder)) {
      await this.exec(['hermes', 'project', 'add-folder', slug, folder]);
      await this.exec(['hermes', 'project', 'set-primary', slug, folder]);
    }
    const hermesId = parseProjectId(shown);
    if (!hermesId) throw lifecycleError('Hermes did not report a project id');
    const entry = { slug, hermesId, repo: project.repo || null };
    const all = await this.read();
    all[project.id] = entry;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`);
    this.logger?.info?.('hermes_project_synced', { slug });
    await this.mirror();
    return entry;
  }

  sync(project) {
    void this.ensure(project).catch((error) => this.logger?.warn?.('hermes_project_sync_failed', { message: error.message }));
  }

  async syncAll() {
    for (const project of await this.store.listProjects()) await this.ensure(project).catch((error) => this.logger?.warn?.('hermes_project_sync_failed', { message: error.message }));
    await this.mirror();
    await this.scopeBoard('default').catch((error) => this.logger?.warn?.('hermes_board_scope_failed', { message: error.message }));
  }

  async mirror({ ifStaleMs = 0 } = {}) {
    if (ifStaleMs && Date.now() - (this.mirroredAt || 0) < ifStaleMs) return;
    this.mirroredAt = Date.now();
    await this.exec(['python3', '-c', MIRROR_SCRIPT]).catch((error) => this.logger?.warn?.('hermes_project_mirror_failed', { message: error.message }));
  }

  async scopeBoard(board) {
    const entry = await this.ensure(await this.store.ensureGeneralProject());
    if (!entry) return null;
    await this.exec(['python3', '-c', SCOPE_BOARD_SCRIPT, board, entry.hermesId]);
    await this.mirror();
    return entry;
  }

  async byHermesId() {
    return Object.fromEntries(Object.entries(await this.read()).map(([projectId, entry]) => [entry.hermesId, projectId]));
  }

  async slugs() {
    return Object.fromEntries(Object.entries(await this.read()).map(([projectId, entry]) => [projectId, entry.slug]));
  }
}
