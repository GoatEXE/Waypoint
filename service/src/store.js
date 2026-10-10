import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from './errors.js';
import { normalizeRepo } from './github.js';

export const MISSION_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
const MISSION_TRANSITIONS = {
  backlog: ['todo', 'in_progress', 'in_review', 'done', 'canceled'],
  todo: ['backlog', 'in_progress', 'in_review', 'done', 'canceled'],
  in_progress: ['todo', 'in_review', 'done', 'canceled'],
  in_review: ['todo', 'in_progress', 'done', 'canceled'],
  done: ['todo', 'in_review'],
  canceled: ['backlog', 'todo'],
};
const STORED_ID_RE = {
  mission: /^mission_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  project: /^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};
const BOARD_TASK_RE = /^t_[0-9a-f]{6,32}$/;
const MISSION_TITLE_MAX = 120;
const MISSION_OUTCOME_MAX = 1000;
const PROJECT_NAME_MAX = 80;
const MISSION_SOURCES = new Set(['ceo', 'app']);

function safeId(prefix) { return `${prefix}_${randomUUID()}`; }
function assertStoredId(prefix, id) {
  const value = String(id || '');
  if (!STORED_ID_RE[prefix].test(value)) throw badRequest('invalid resource id', { prefix });
  return value;
}
function assertPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${field} must be an object`);
}
function optionalText(value, field, max) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw badRequest(`${field} must be at most ${max} characters`);
  return value.trim();
}
function normalizeTarget(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw badRequest('target must be a YYYY-MM-DD date');
  return value;
}
function projectName(value) {
  if (typeof value !== 'string') throw badRequest('project name must be text');
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > PROJECT_NAME_MAX || /[\x00-\x1f\x7f]/.test(text)) throw badRequest(`project name must be 1-${PROJECT_NAME_MAX} visible characters`);
  return text;
}
function sameTitle(a, b) { return String(a).trim().toLocaleLowerCase() === String(b).trim().toLocaleLowerCase(); }

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  for (let attempt = 0; ; attempt += 1) {
    try { await fs.rename(tmp, filePath); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 10) { await fs.unlink(tmp).catch(() => {}); throw error; }
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
export async function readJson(filePath) {
  for (let attempt = 0; ; attempt += 1) {
    try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return undefined;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

export class OrgStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.queues = new Map();
  }

  async ensure() { await fs.mkdir(this.dataDir, { recursive: true }); }

  #serialize(key, fn) {
    const run = (this.queues.get(key) || Promise.resolve()).then(fn);
    const settled = run.catch(() => {});
    this.queues.set(key, settled);
    settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key); });
    return run;
  }

  projectsPath() { return path.join(this.dataDir, 'projects.json'); }
  missionPath(missionId) { return path.join(this.dataDir, 'missions', `${assertStoredId('mission', missionId)}.json`); }

  async readProjects() {
    return ((await readJson(this.projectsPath()))?.projects || []).map(({ id, name, missionId = null, repo = null, createdAt, updatedAt }) => ({ id, name, missionId, repo, createdAt, updatedAt }));
  }
  async listProjects() {
    return [...await this.readProjects()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async getProject(projectId) {
    const id = assertStoredId('project', projectId);
    const project = (await this.readProjects()).find((item) => item.id === id);
    if (!project) throw notFound('project not found', { projectId: id });
    return project;
  }
  createProject(input) {
    return this.#serialize('projects', async () => {
      assertPlainObject(input, 'body');
      const projects = await this.readProjects();
      const now = new Date().toISOString();
      const project = { id: safeId('project'), ...await this.#projectFields(input, null, projects), createdAt: now, updatedAt: now };
      await writeJson(this.projectsPath(), { projects: [...projects, project] });
      return project;
    });
  }
  updateProject(projectId, input) {
    const id = assertStoredId('project', projectId);
    return this.#serialize('projects', async () => {
      assertPlainObject(input, 'body');
      const projects = await this.readProjects();
      const current = projects.find((project) => project.id === id);
      if (!current) throw notFound('project not found', { projectId: id });
      const updated = { ...current, ...await this.#projectFields(input, current, projects), updatedAt: new Date().toISOString() };
      await writeJson(this.projectsPath(), { projects: projects.map((project) => (project.id === id ? updated : project)) });
      return updated;
    });
  }
  deleteProject(projectId) {
    const id = assertStoredId('project', projectId);
    return this.#serialize('projects', async () => {
      const projects = await this.readProjects();
      if (!projects.some((project) => project.id === id)) throw notFound('project not found', { projectId: id });
      await writeJson(this.projectsPath(), { projects: projects.filter((project) => project.id !== id) });
      return { deleted: true, projectId: id };
    });
  }
  async #projectFields(input, current, projects) {
    const extra = Object.keys(input).filter((key) => !['name', 'missionId', 'repo'].includes(key));
    if (extra.length) throw badRequest('unsupported project fields', { fields: extra.slice(0, 10).map((key) => key.slice(0, 64)) });
    const has = (key) => Object.hasOwn(input, key);
    const name = has('name') ? projectName(input.name) : current?.name;
    if (!name) throw badRequest('project name is required');
    if (projects.some((project) => project.id !== current?.id && project.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw conflict('a project with this name already exists', { name });
    const missionId = has('missionId') ? (input.missionId ? assertStoredId('mission', String(input.missionId)) : null) : current?.missionId ?? null;
    if (has('missionId') && missionId && !(await readJson(this.missionPath(missionId)))) throw badRequest('missionId does not match a stored mission', { missionId });
    const repo = has('repo') ? (input.repo ? normalizeRepo(input.repo) : null) : current?.repo ?? null;
    return { name, missionId, repo };
  }
  async projectGithubRepos() {
    return [...new Set((await this.readProjects()).filter((project) => project.repo).map((project) => project.repo))];
  }

  createMission(input, { source = 'app' } = {}) {
    return this.#serialize('missions', async () => {
      assertPlainObject(input, 'body');
      if (!MISSION_SOURCES.has(source)) throw badRequest('unsupported mission source');
      const extra = Object.keys(input).filter((key) => !['title', 'outcome', 'target', 'taskId'].includes(key));
      if (extra.length) throw badRequest('unsupported mission fields', { fields: extra.slice(0, 10) });
      const title = optionalText(input.title, 'title', MISSION_TITLE_MAX);
      if (!title) throw badRequest('title is required');
      const outcome = optionalText(input.outcome, 'outcome', MISSION_OUTCOME_MAX);
      const target = normalizeTarget(input.target);
      const taskId = input.taskId ? this.#boardTask(input.taskId) : null;
      const existing = (await this.readMissions()).find((mission) => sameTitle(mission.title, title));
      if (existing) {
        if ((existing.taskId || null) === taskId) return { created: false, mission: existing };
        throw conflict('a mission with this title already exists', { missionId: existing.id });
      }
      const now = new Date().toISOString();
      const mission = { id: safeId('mission'), title, outcome, target, taskId, status: taskId ? 'in_progress' : 'backlog', source, createdAt: now, updatedAt: now };
      await writeJson(this.missionPath(mission.id), mission);
      return { created: true, mission };
    });
  }
  linkMission(missionId, input) {
    return this.#serialize('missions', async () => {
      assertPlainObject(input, 'body');
      const mission = await this.getMission(missionId);
      const taskId = this.#boardTask(input.taskId);
      if (mission.taskId && mission.taskId !== taskId) throw conflict('mission is already linked to a different task', { missionId });
      const updated = { ...mission, taskId, updatedAt: new Date().toISOString() };
      await writeJson(this.missionPath(mission.id), updated);
      return updated;
    });
  }
  updateMissionStatus(missionId, status) {
    return this.updateMission(missionId, { status });
  }
  updateMission(missionId, input) {
    return this.#serialize('missions', async () => {
      assertPlainObject(input, 'body');
      const fields = Object.keys(input);
      const extra = fields.filter((key) => !['title', 'outcome', 'target', 'status'].includes(key));
      if (extra.length) throw badRequest('unsupported mission fields', { fields: extra.slice(0, 10) });
      if (!fields.length) throw badRequest('nothing to update');
      const mission = await this.getMission(missionId);
      const updated = { ...mission };
      if ('status' in input) {
        const { status } = input;
        if (!MISSION_STATUSES.includes(status)) throw badRequest(`status must be one of ${MISSION_STATUSES.join(', ')}`);
        if (mission.status !== status && !MISSION_TRANSITIONS[mission.status]?.includes(status)) throw badRequest(`status cannot move from ${mission.status} to ${status}`);
        updated.status = status;
      }
      if ('title' in input) {
        const title = optionalText(input.title, 'title', MISSION_TITLE_MAX);
        if (!title) throw badRequest('title is required');
        const clash = (await this.readMissions()).find((other) => other.id !== mission.id && sameTitle(other.title, title));
        if (clash) throw conflict('a mission with this title already exists', { missionId: clash.id });
        updated.title = title;
      }
      if ('outcome' in input) updated.outcome = optionalText(input.outcome, 'outcome', MISSION_OUTCOME_MAX);
      if ('target' in input) updated.target = normalizeTarget(input.target);
      updated.updatedAt = new Date().toISOString();
      await writeJson(this.missionPath(mission.id), updated);
      return updated;
    });
  }
  deleteMission(missionId) {
    return this.#serialize('missions', async () => {
      const mission = await this.getMission(missionId);
      await fs.unlink(this.missionPath(mission.id));
      return { deleted: true, missionId: mission.id };
    });
  }
  async getMission(missionId) {
    const mission = await readJson(this.missionPath(missionId));
    if (!mission) throw notFound('mission not found', { missionId });
    return { ...mission, status: MISSION_STATUSES.includes(mission.status) ? mission.status : 'backlog', taskId: BOARD_TASK_RE.test(String(mission.taskId || '')) ? mission.taskId : null };
  }
  async readMissions() {
    const dir = path.join(this.dataDir, 'missions');
    let names = [];
    try { names = await fs.readdir(dir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const missions = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (name.endsWith('.json') && STORED_ID_RE.mission.test(id)) missions.push(await this.getMission(id));
    }
    return missions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async listMissions() { return this.readMissions(); }

  #boardTask(value) {
    const id = String(value || '').trim();
    if (!BOARD_TASK_RE.test(id)) throw badRequest('taskId must be a board task id such as t_1a2b3c4d');
    return id;
  }
}
