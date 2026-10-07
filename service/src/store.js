import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from './errors.js';
import { sanitizeResponse } from './podTaskExecutor.js';

export const ALLOWED_BASELINE_FILES = ['SOUL.md', 'memories/MEMORY.md', 'memories/USER.md'];
const NAME_RE = /^[a-z][a-z0-9_-]{1,62}$/;
export const HERMES_RESERVED_PROFILE_NAMES = new Set([
  'auth', 'config', 'default', 'global', 'hermes', 'home', 'memories', 'memory', 'plugins', 'root', 'shared', 'skills', 'sudo', 'system', 'test', 'tmp', 'workspace',
  'hermes-agent', 'waypoint-ceo', 'waypoint-ceo-bridge',
]);
const STORED_ID_RE = {
  tpl: /^tpl_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  pod: /^pod_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  task: /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  mission: /^mission_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  run: /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};
const MISSION_TITLE_MAX = 120;
const MISSION_OUTCOME_MAX = 1000;
const MISSION_SOURCES = new Set(['ceo', 'app']);
// Task runs: at most one claimed run per task. Only these outcomes finish a run; a dry run or a preflight
// failure (no model turn started) releases the claim with abortTaskRun instead.
export const TASK_RUN_OUTCOMES = ['completed', 'failed', 'outcome_unknown'];
// Task states that refuse a new claim unless the caller explicitly asks for a manual retry.
const TASK_RUN_LOCKED_STATES = new Set(['running', ...TASK_RUN_OUTCOMES]);
const SESSION_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
const EVIDENCE_TYPE_RE = /^[a-z][a-z0-9_]{0,31}$/;
const RUN_REASON_RE = /^[a-z][a-z0-9_]{0,63}$/;
const RUN_REPLY_MAX = 8000;
const RUN_MESSAGE_MAX = 500;
const RUN_ERROR_MAX = 200;
const RUN_EVIDENCE_PER_RUN = 8;
const RUN_EVIDENCE_KEEP = 32;
const RUNS_KEEP = 10;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
// The only evidence fields a run persists; plans, command args, tool data, and stderr are dropped.
const RUN_EVIDENCE_INT_FIELDS = ['exitCode', 'resultExitCode', 'toolCalls', 'partialTextChars', 'fixturesCreated', 'fixturesUnchanged'];
const RUN_EVIDENCE_BOOL_FIELDS = ['timedOut', 'automaticRetry', 'partialTextTruncated', 'modelTurnStarted'];
const HOST_PATH_RE = /(?:\b[A-Za-z]:[\\/]|\\\\)[^\s"'`<>|]*|(?<![\w/.])\/(?:home|Users|root|mnt|var|tmp|private|srv)\/[^\s"'`<>|]*/g;

function isAllowedBaselineFile(filePath) {
  if (ALLOWED_BASELINE_FILES.includes(filePath)) return true;
  if (/^skills\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(filePath)) return true;
  return /^skills\/[A-Za-z0-9][A-Za-z0-9._-]*\/SKILL\.md$/.test(filePath);
}
function safeId(prefix) { return `${prefix}_${randomUUID()}`; }
function assertStoredId(prefix, id) {
  const value = String(id || '');
  if (!STORED_ID_RE[prefix].test(value)) throw badRequest('invalid resource id', { prefix });
  return value;
}
async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, filePath);
}
async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
function assertPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${field} must be an object`);
}
function assertNoSecretKeys(value, pathParts = []) {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecretKeys(item, [...pathParts, String(index)]));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/secret|token|password|credential|api[_-]?key|bws/i.test(key)) throw badRequest('Config and baseline metadata must not contain secret-like keys', { path: [...pathParts, key].join('.') });
    assertNoSecretKeys(child, [...pathParts, key]);
  }
}
function normalizeWaypointName(value, field, details = {}) {
  const text = String(value || '').trim();
  if (!NAME_RE.test(text)) throw badRequest(`${field} must be lowercase alphanumeric with dashes/underscores`, details);
  if (HERMES_RESERVED_PROFILE_NAMES.has(text)) throw badRequest(`${field} is reserved by Hermes or Waypoint`, { ...details, name: text });
  return text;
}
function normalizeSeats(seats) {
  if (!Array.isArray(seats) || seats.length < 1) throw badRequest('seats must contain at least one seat definition');
  const seen = new Set();
  return seats.map((seat, index) => {
    assertPlainObject(seat, `seats[${index}]`);
    const id = normalizeWaypointName(seat.id, 'seat id', { index });
    const role = String(seat.role || '').trim();
    if (!role) throw badRequest('seat role is required', { index });
    if (seen.has(id)) throw badRequest('seat ids must be unique', { id });
    seen.add(id);
    return { id, role, instructions: typeof seat.instructions === 'string' ? seat.instructions : '' };
  });
}
function normalizeBaselineFiles(baselineFiles = {}) {
  assertPlainObject(baselineFiles, 'baselineFiles');
  const normalized = {};
  for (const [filePath, content] of Object.entries(baselineFiles)) {
    if (filePath.includes('..') || path.isAbsolute(filePath) || !isAllowedBaselineFile(filePath)) throw badRequest('baseline file is not allowlisted', { filePath });
    if (typeof content !== 'string') throw badRequest('baseline file content must be text', { filePath });
    normalized[filePath] = content;
  }
  return normalized;
}
function instanceDirFor(dataDir, podId) { return path.join(dataDir, 'instances', assertStoredId('pod', podId)); }
function profilesDirFor(dataDir, podId) { return path.join(instanceDirFor(dataDir, podId), 'profiles'); }
function seatProfileDirFor(dataDir, podId, seatId) { return path.join(profilesDirFor(dataDir, podId), normalizeWaypointName(seatId, 'seat id')); }
function normalizeStoredInstance(manifest, podId, dataDir, dockerPlanFactory) {
  assertPlainObject(manifest, 'pod manifest');
  if (manifest.id && manifest.id !== podId) throw badRequest('pod manifest id does not match storage path', { podId });
  const podName = normalizeWaypointName(manifest.podName, 'podName');
  const seats = Array.isArray(manifest.seats) ? manifest.seats.map((seat, index) => {
    assertPlainObject(seat, `seats[${index}]`);
    const id = normalizeWaypointName(seat.id, 'seat id', { index });
    return { ...seat, id, profileDir: seatProfileDirFor(dataDir, podId, id) };
  }) : [];
  const instanceDir = instanceDirFor(dataDir, podId);
  const profilesDir = profilesDirFor(dataDir, podId);
  const { dockerPlan: _staleDockerPlan, instanceDir: _storedInstanceDir, profilesDir: _storedProfilesDir, ...rest } = manifest;
  const normalized = {
    ...rest,
    id: podId,
    podName,
    state: typeof manifest.state === 'string' ? manifest.state : 'planned',
    instanceDir,
    profilesDir,
    seats,
    planSource: 'derived-from-service-config',
  };
  if (dockerPlanFactory) normalized.dockerPlan = dockerPlanFactory({ podId, podName, templateId: manifest.templateId, templateVersion: manifest.templateVersion });
  return normalized;
}
async function materializeSeatProfile(profileDir, seat, baselineFiles) {
  await fs.mkdir(profileDir, { recursive: true });
  const copiedFiles = [];
  for (const [relativePath, content] of Object.entries(baselineFiles)) {
    const destination = path.join(profileDir, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, { flag: 'wx' });
    copiedFiles.push(relativePath);
  }
  await writeJson(path.join(profileDir, 'WAYPOINT_SEAT.json'), {
    seatId: seat.id,
    role: seat.role,
    instructions: seat.instructions,
    materializedAt: new Date().toISOString(),
    note: 'Waypoint-generated seat metadata; not a secret source.',
  });
  return copiedFiles;
}

function optionalText(value, field, max) {
  if (value == null) return '';
  if (typeof value !== 'string') throw badRequest(`${field} must be text`);
  const text = value.trim();
  if (text.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return text;
}
function normalizeTarget(value) {
  const target = optionalText(value, 'target', 10);
  if (!target) return '';
  const parsed = new Date(`${target}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== target) throw badRequest('target must be a YYYY-MM-DD date');
  return target;
}
const sameTitle = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Redacts host paths (including the data dir) and secrets, strips control characters, and caps length. */
function runText(value, max, dataDir) {
  if (typeof value !== 'string') return '';
  const scrubbed = (dataDir ? value.split(dataDir).join('[host-path]') : value).replace(HOST_PATH_RE, '[host-path]');
  return sanitizeResponse(scrubbed, max);
}
function runTimestamp(value, fallback) {
  const parsed = typeof value === 'string' && value.length <= 40 ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : fallback;
}
/** Keeps only allowlisted, bounded evidence fields from an executor result and tags them with the run id. */
function runEvidence(entries, runId, dataDir, now) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)).slice(0, RUN_EVIDENCE_PER_RUN).map((entry) => {
    const item = { type: EVIDENCE_TYPE_RE.test(String(entry.type)) ? entry.type : 'note', message: runText(entry.message, RUN_MESSAGE_MAX, dataDir), at: runTimestamp(entry.at, now), runId };
    for (const key of RUN_EVIDENCE_INT_FIELDS) if (Number.isSafeInteger(entry[key])) item[key] = entry[key];
    for (const key of RUN_EVIDENCE_BOOL_FIELDS) if (typeof entry[key] === 'boolean') item[key] = entry[key];
    if (entry.retry === 'manual_review_required') item.retry = entry.retry;
    if (entry.tokens && typeof entry.tokens === 'object') {
      const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
      item.tokens = { input: count(entry.tokens.input), output: count(entry.tokens.output), total: count(entry.tokens.total) };
    }
    const error = runText(entry.error, RUN_ERROR_MAX, dataDir);
    if (error) item.error = error;
    return item;
  });
}
/** Delegation evidence (no runId) is always kept; run evidence keeps only the most recent entries. */
function withRunEvidence(existing, added) {
  const list = Array.isArray(existing) ? existing : [];
  return [...list.filter((entry) => !entry?.runId), ...[...list.filter((entry) => entry?.runId), ...added].slice(-RUN_EVIDENCE_KEEP)];
}

export class PodStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.missionQueue = Promise.resolve();
    // Per-resource write queues ('task:<id>', 'pod:<id>') so read-modify-write updates are not lost in this process.
    this.queues = new Map();
    // Run ids claimed by this process and not yet finished; a persisted 'running' run outside this set is stale.
    this.activeTaskRuns = new Set();
  }
  async ensure() { await fs.mkdir(this.dataDir, { recursive: true }); }
  async createTemplate(input) {
    assertPlainObject(input, 'body');
    const name = String(input.name || '').trim();
    const version = String(input.version || '').trim();
    if (!name) throw badRequest('name is required');
    if (!version) throw badRequest('version is required');
    const config = input.config || {};
    assertPlainObject(config, 'config');
    assertNoSecretKeys(config);
    const template = { id: safeId('tpl'), name, version, seats: normalizeSeats(input.seats), baselineFiles: normalizeBaselineFiles(input.baselineFiles || {}), config, createdAt: new Date().toISOString() };
    await writeJson(this.templatePath(template.id), template);
    return template;
  }
  async getTemplate(templateId) {
    const template = await readJson(this.templatePath(templateId));
    if (!template) throw notFound('template not found', { templateId });
    return template;
  }
  async cloneTemplate(templateId, input, dockerPlanFactory) {
    assertPlainObject(input, 'body');
    const template = await this.getTemplate(templateId);
    const podName = normalizeWaypointName(input.podName, 'podName');
    await this.ensurePodNameAvailable(podName);
    const podId = safeId('pod');
    const instanceDir = instanceDirFor(this.dataDir, podId);
    const profilesDir = profilesDirFor(this.dataDir, podId);
    await fs.mkdir(profilesDir, { recursive: true });
    const seats = [];
    for (const seat of template.seats) {
      const profileDir = path.join(profilesDir, seat.id);
      const copiedFiles = await materializeSeatProfile(profileDir, seat, template.baselineFiles);
      seats.push({ ...seat, state: 'materialized', profileDir, copiedFiles });
    }
    const instance = {
      id: podId,
      podName,
      templateId: template.id,
      templateVersion: template.version,
      state: 'planned',
      instanceDir,
      profilesDir,
      seats,
      dockerPlan: dockerPlanFactory({ podId, podName, template, instanceDir }),
      planSource: 'derived-from-service-config',
      createdAt: new Date().toISOString(),
    };
    await writeJson(this.instancePath(podId), instance);
    return instance;
  }
  async getInstance(podId, { dockerPlanFactory } = {}) {
    podId = assertStoredId('pod', podId);
    const instance = await readJson(this.instancePath(podId));
    if (!instance) throw notFound('pod instance not found', { podId });
    return normalizeStoredInstance(instance, podId, this.dataDir, dockerPlanFactory);
  }
  recordLifecycle(podId, lifecycleResult, dockerPlanFactory) {
    podId = assertStoredId('pod', podId);
    return this.#serialize(`pod:${podId}`, () => this.#recordLifecycle(podId, lifecycleResult, dockerPlanFactory));
  }
  async #recordLifecycle(podId, lifecycleResult, dockerPlanFactory) {
    const filePath = this.instancePath(podId);
    const stored = await readJson(filePath);
    if (!stored) throw notFound('pod instance not found', { podId });
    const current = normalizeStoredInstance(stored, podId, this.dataDir, dockerPlanFactory);
    const status = lifecycleResult?.status;
    const nextState = lifecycleResult?.dryRun ? current.state : status?.running ? 'running' : status?.state === 'missing' ? 'missing' : status?.state === 'exited' ? 'stopped' : current.state;
    const updated = {
      ...stored,
      id: podId,
      podName: current.podName,
      state: nextState,
      instanceDir: current.instanceDir,
      profilesDir: current.profilesDir,
      seats: current.seats,
      dockerPlan: dockerPlanFactory({ podId, podName: current.podName, templateId: current.templateId, templateVersion: current.templateVersion }),
      planSource: 'derived-from-service-config',
      lifecycle: {
        lastAction: lifecycleResult?.action || '',
        dryRun: Boolean(lifecycleResult?.dryRun),
        executed: Boolean(lifecycleResult?.executed),
        status: status || null,
        updatedAt: new Date().toISOString(),
      },
    };
    await writeJson(filePath, updated);
    return normalizeStoredInstance(updated, podId, this.dataDir, dockerPlanFactory);
  }
  /**
   * Sets (or clears with null) the durable Hermes model for one seat of a pod. The model is validated by
   * podSeats.normalizeSeatModel (provider/default/api_mode/base_url only; secret-like or unknown fields are
   * rejected) and stored on the seat; the rest of the manifest is preserved. Returns a path-free summary.
   */
  async setSeatModel(podId, seatId, model) {
    podId = assertStoredId('pod', podId);
    const id = String(seatId ?? '');
    if (!NAME_RE.test(id)) throw badRequest('invalid seat id', { seatId: id.slice(0, 64) });
    // Loaded lazily: podSeats.js imports store.js at evaluation time, so a static import would be a module cycle.
    const { normalizeSeatModel } = await import('./podSeats.js');
    const value = model == null ? null : normalizeSeatModel(model, 'seat');
    return this.#serialize(`pod:${podId}`, async () => {
      const filePath = this.instancePath(podId);
      const stored = await readJson(filePath);
      if (!stored) throw notFound('pod instance not found', { podId });
      const current = normalizeStoredInstance(stored, podId, this.dataDir);
      const index = current.seats.findIndex((seat) => seat.id === id);
      if (index < 0) throw notFound('seat not found in pod', { podId, seatId: id });
      const seats = stored.seats.map((seat, i) => {
        if (i !== index) return seat;
        const { model: _previous, ...rest } = seat;
        return value ? { ...rest, model: value } : rest;
      });
      await writeJson(filePath, { ...stored, seats });
      return { podId, podName: current.podName, seat: { id, role: typeof current.seats[index].role === 'string' ? current.seats[index].role : '', model: value } };
    });
  }
  /** Capture the CEO model once for a pod that has no explicit pod or template model. */
  async setPodDefaultModelIfMissing(podId, model) {
    podId = assertStoredId('pod', podId);
    const { normalizeSeatModel } = await import('./podSeats.js');
    const value = normalizeSeatModel(model, 'ceo');
    return this.#serialize(`pod:${podId}`, async () => {
      const filePath = this.instancePath(podId);
      const stored = await readJson(filePath);
      if (!stored) throw notFound('pod instance not found', { podId });
      if (stored.model) return normalizeStoredInstance(stored, podId, this.dataDir);
      const updated = { ...stored, model: value };
      await writeJson(filePath, updated);
      return normalizeStoredInstance(updated, podId, this.dataDir);
    });
  }
  async ensurePodNameAvailable(podName) {
    const instancesDir = path.join(this.dataDir, 'instances');
    let entries = [];
    try { entries = await fs.readdir(instancesDir, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !STORED_ID_RE.pod.test(entry.name)) continue;
      const manifest = await readJson(path.join(instancesDir, entry.name, 'manifest.json'));
      if (manifest?.podName === podName) throw conflict('podName already exists', { podName });
    }
  }
  async createTask(input) {
    assertPlainObject(input, 'body');
    const podId = String(input.podId || '').trim();
    const seatId = String(input.seatId || '').trim();
    const summary = String(input.summary || '').trim();
    if (!podId || !seatId || !summary) throw badRequest('podId, seatId, and summary are required');
    const instance = await this.getInstance(podId);
    if (!instance.seats.some((seat) => seat.id === seatId)) throw conflict('seat does not belong to pod', { podId, seatId });
    const task = { id: safeId('task'), podId, seatId, summary, state: 'delegated', evidence: [{ type: 'record', message: 'Delegation recorded only; no Hermes execution performed.', at: new Date().toISOString() }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeJson(this.taskPath(task.id), task);
    return task;
  }
  async getTask(taskId) {
    const task = await readJson(this.taskPath(taskId));
    if (!task) throw notFound('task not found', { taskId });
    return task;
  }
  async listTasks() {
    const dir = path.join(this.dataDir, 'tasks');
    let names = [];
    try { names = await fs.readdir(dir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const tasks = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !STORED_ID_RE.task.test(id)) continue;
      const task = await readJson(this.taskPath(id));
      if (task?.id !== id) continue;
      tasks.push({ id, podId: task.podId, seatId: task.seatId, summary: task.summary, state: task.state, updatedAt: task.updatedAt });
    }
    return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || b.id.localeCompare(a.id));
  }
  /**
   * Claims the next run of a task before any Hermes invocation and persists it as 'running' with a unique runId.
   * Refuses while a run is running and after a run finished (completed, failed, outcome_unknown), including after
   * a restart. `manualRetry: true` is an explicit operator decision: it allows a new run after a finished outcome,
   * or closes a run left 'running' by a previous process as outcome_unknown. Nothing is ever retried automatically.
   */
  claimTaskRun(taskId, { manualRetry = false } = {}) {
    return this.#withTaskRunLock(taskId, async (id) => {
      let task = await this.getTask(id);
      const stale = task.state === 'running' && !this.activeTaskRuns.has(task.activeRunId);
      if (task.state === 'running' && !(manualRetry && stale)) throw conflict('task already has a run in progress; outcome must be reviewed before any new run', { taskId: id, state: 'running' });
      if (stale) task = await this.#interruptRun(task);
      const fromState = task.state;
      if (fromState !== 'delegated' && !(manualRetry && TASK_RUN_LOCKED_STATES.has(fromState))) throw conflict(`task run already ended as ${String(fromState).slice(0, 32)}; manual review is required before any new run`, { taskId: id, state: String(fromState).slice(0, 32) });
      const now = new Date().toISOString();
      const run = { id: safeId('run'), state: 'running', startedAt: now, fromState, ...(manualRetry && fromState !== 'delegated' ? { manualRetry: true } : {}) };
      const runs = Array.isArray(task.runs) ? task.runs : [];
      const updated = { ...task, state: 'running', activeRunId: run.id, runs: [...runs, run].slice(-RUNS_KEEP), updatedAt: now };
      await writeJson(this.taskPath(id), updated);
      this.activeTaskRuns.add(run.id);
      return { task: updated, runId: run.id };
    });
  }
  /**
   * Startup reconciliation: every task persisted as 'running' whose run is not owned by this process was
   * interrupted by a previous service process, so it is closed as outcome_unknown (reason 'service_restarted').
   * Nothing is retried or reported as completed; the task stays locked until a manual retry.
   * Call once before accepting run requests. Returns the interrupted { taskId, runId } pairs.
   */
  async markInterruptedTaskRuns() {
    const dir = path.join(this.dataDir, 'tasks');
    let names = [];
    try { names = await fs.readdir(dir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const interrupted = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !STORED_ID_RE.task.test(id)) continue;
      const closed = await this.#withTaskRunLock(id, async () => {
        const task = await readJson(this.taskPath(id));
        if (task?.id !== id || task.state !== 'running' || this.activeTaskRuns.has(task.activeRunId)) return null;
        const updated = await this.#interruptRun(task);
        return { taskId: id, runId: updated.lastRunId };
      });
      if (closed) interrupted.push(closed);
    }
    return interrupted;
  }
  /**
   * Persists the result of a model turn for the claimed run only. The reply and evidence are sanitized and capped;
   * the task then stays locked in completed/failed/outcome_unknown. A dry run or a preflight failure must use
   * abortTaskRun instead, so an unknown outcome string is rejected and the run stays 'running' (locked).
   */
  finishTaskRun(taskId, runId, result) {
    return this.#withTaskRunLock(taskId, async (id) => {
      assertPlainObject(result, 'run result');
      if (!TASK_RUN_OUTCOMES.includes(result.outcome)) throw badRequest('run outcome must be completed, failed, or outcome_unknown; release a run without a model turn with abortTaskRun');
      const { task, run } = await this.#activeRun(id, runId);
      const now = new Date().toISOString();
      const fullReply = runText(result.text, Number.MAX_SAFE_INTEGER, this.dataDir);
      const finished = {
        ...run,
        state: result.outcome,
        finishedAt: now,
        durationMs: Number.isSafeInteger(result.durationMs) && result.durationMs >= 0 ? Math.min(result.durationMs, MAX_DURATION_MS) : null,
        sessionId: typeof result.sessionId === 'string' && SESSION_ID_RE.test(result.sessionId) ? result.sessionId : null,
        reply: fullReply.length > RUN_REPLY_MAX ? sanitizeResponse(fullReply, RUN_REPLY_MAX) : fullReply,
        replyTruncated: fullReply.length > RUN_REPLY_MAX,
      };
      return this.#closeRun(task, finished, result.outcome, runEvidence(result.evidence, run.id, this.dataDir, now), now);
    });
  }
  /**
   * Releases a claimed run when the caller knows no model turn started (dry run, readiness or workspace
   * preflight error). The task returns to the state it had before the claim, normally 'delegated'.
   */
  abortTaskRun(taskId, runId, { reason = 'preflight_failed' } = {}) {
    return this.#withTaskRunLock(taskId, async (id) => {
      const { task, run } = await this.#activeRun(id, runId);
      const now = new Date().toISOString();
      const safeReason = typeof reason === 'string' && RUN_REASON_RE.test(reason) ? reason : 'preflight_failed';
      const restored = TASK_RUN_LOCKED_STATES.has(run.fromState) && run.fromState !== 'running' ? run.fromState : 'delegated';
      const evidence = [{ type: 'run_aborted', message: `Run released before any model turn started (${safeReason}); task returned to ${restored}.`, reason: safeReason, at: now, runId: run.id }];
      return this.#closeRun(task, { ...run, state: 'aborted', finishedAt: now, reason: safeReason }, restored, evidence, now);
    });
  }
  async #activeRun(taskId, runId) {
    const id = assertStoredId('run', runId);
    const task = await this.getTask(taskId);
    const run = Array.isArray(task.runs) ? task.runs.find((item) => item?.id === id) : undefined;
    if (task.state !== 'running' || task.activeRunId !== id || !run) throw conflict('run is not the active run for this task', { taskId, runId: id });
    return { task, run };
  }
  /** Closes a 'running' run left by a previous process as outcome_unknown. */
  #interruptRun(task) {
    const now = new Date().toISOString();
    const runs = Array.isArray(task.runs) ? task.runs : [];
    const runId = STORED_ID_RE.run.test(String(task.activeRunId)) ? task.activeRunId : safeId('run');
    const run = runs.find((item) => item?.id === runId) || { id: runId, state: 'running', fromState: 'delegated' };
    const evidence = [{ type: 'run_interrupted', message: 'Service stopped before the run outcome was confirmed; outcome is unknown. Manual review is required before any retry; Waypoint never retries automatically.', reason: 'service_restarted', at: now, runId }];
    return this.#closeRun({ ...task, runs }, { ...run, state: 'outcome_unknown', finishedAt: now, reason: 'service_restarted' }, 'outcome_unknown', evidence, now);
  }
  async #closeRun(task, run, state, evidence, now) {
    const { activeRunId: _closed, ...rest } = task;
    const runs = Array.isArray(task.runs) ? task.runs : [];
    const merged = runs.some((item) => item?.id === run.id) ? runs.map((item) => (item?.id === run.id ? run : item)) : [...runs, run].slice(-RUNS_KEEP);
    const updated = { ...rest, state, lastRunId: run.id, runs: merged, evidence: withRunEvidence(task.evidence, evidence), updatedAt: now };
    await writeJson(this.taskPath(task.id), updated);
    this.activeTaskRuns.delete(run.id);
    return updated;
  }
  /** Serializes run state changes per task so a claim is check-and-set within this process. */
  async #withTaskRunLock(taskId, fn) {
    const id = assertStoredId('task', taskId);
    return this.#serialize(`task:${id}`, () => fn(id));
  }
  #serialize(key, fn) {
    const run = (this.queues.get(key) || Promise.resolve()).then(fn);
    const settled = run.catch(() => {});
    this.queues.set(key, settled);
    settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key); });
    return run;
  }
  /**
   * Records a mission and, optionally, the pod and delegated task working on it.
   * Idempotent by title: repeating the same title with the same links returns the existing record.
   * State only reflects what Waypoint has recorded ('planned' or 'delegated'); it never claims execution.
   */
  createMission(input, { source = 'app' } = {}) {
    const run = this.missionQueue.then(() => this.#createMission(input, source));
    this.missionQueue = run.catch(() => {});
    return run;
  }
  async #createMission(input, source) {
    assertPlainObject(input, 'body');
    if (!MISSION_SOURCES.has(source)) throw badRequest('unsupported mission source');
    const title = optionalText(input.title, 'title', MISSION_TITLE_MAX);
    if (!title) throw badRequest('title is required');
    const outcome = optionalText(input.outcome, 'outcome', MISSION_OUTCOME_MAX);
    const target = normalizeTarget(input.target);
    const { podId, taskId } = await this.resolveMissionLinks(input);
    const existing = (await this.readMissions()).find((mission) => sameTitle(mission.title, title));
    if (existing) {
      if (existing.podId === podId && existing.taskId === taskId) return { created: false, mission: await this.missionView(existing) };
      throw conflict('a mission with this title already exists', { missionId: existing.id });
    }
    const now = new Date().toISOString();
    const mission = { id: safeId('mission'), title, outcome, target, podId, taskId, state: taskId ? 'delegated' : 'planned', source, createdAt: now, updatedAt: now };
    await writeJson(this.missionPath(mission.id), mission);
    return { created: true, mission: await this.missionView(mission) };
  }
  /** Attaches a pod and/or delegated task to a mission. Links can be added, not silently replaced. */
  linkMission(missionId, input) {
    const run = this.missionQueue.then(() => this.#linkMission(missionId, input));
    this.missionQueue = run.catch(() => {});
    return run;
  }
  async #linkMission(missionId, input) {
    assertPlainObject(input, 'body');
    const mission = await readJson(this.missionPath(missionId));
    if (!mission) throw notFound('mission not found', { missionId });
    const links = await this.resolveMissionLinks({ podId: input.podId || mission.podId, taskId: input.taskId || mission.taskId });
    if (!links.podId && !links.taskId) throw badRequest('podId or taskId is required');
    if ((mission.podId && mission.podId !== links.podId) || (mission.taskId && mission.taskId !== links.taskId)) throw conflict('mission is already linked to a different pod or task', { missionId });
    const updated = { ...mission, ...links, state: links.taskId ? 'delegated' : mission.state, updatedAt: new Date().toISOString() };
    await writeJson(this.missionPath(mission.id), updated);
    return this.missionView(updated);
  }
  /** Validates optional pod/task ids against stored records; a task implies its own pod. */
  async resolveMissionLinks(input) {
    let podId = input.podId ? assertStoredId('pod', String(input.podId).trim()) : null;
    const taskId = input.taskId ? assertStoredId('task', String(input.taskId).trim()) : null;
    if (podId) await this.getInstance(podId).catch((error) => { throw error.status === 404 ? badRequest('podId does not match a stored pod', { podId }) : error; });
    if (taskId) {
      const task = await this.getTask(taskId).catch((error) => { throw error.status === 404 ? badRequest('taskId does not match a stored task', { taskId }) : error; });
      if (podId && task.podId !== podId) throw conflict('task does not belong to the linked pod', { podId, taskId });
      podId = task.podId;
    }
    return { podId, taskId };
  }
  async listMissions() {
    const missions = await this.readMissions();
    return Promise.all(missions.map((mission) => this.missionView(mission)));
  }
  async getMission(missionId) {
    const mission = await readJson(this.missionPath(missionId));
    if (!mission) throw notFound('mission not found', { missionId });
    return this.missionView(mission);
  }
  /** Removes only the mission record. Linked pods and tasks have independent lifecycles. */
  deleteMission(missionId) {
    const run = this.missionQueue.then(async () => {
      const file = this.missionPath(missionId);
      const mission = await readJson(file);
      if (!mission) throw notFound('mission not found', { missionId });
      await fs.unlink(file);
      return { deleted: true, missionId: mission.id, podId: mission.podId, taskId: mission.taskId };
    });
    this.missionQueue = run.catch(() => {});
    return run;
  }
  /** Newest first. Unreadable or foreign files in the missions folder are skipped. */
  async readMissions() {
    const dir = path.join(this.dataDir, 'missions');
    let names = [];
    try { names = await fs.readdir(dir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const missions = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !STORED_ID_RE.mission.test(id)) continue;
      const mission = await readJson(path.join(dir, name));
      if (mission?.id === id) missions.push(mission);
    }
    return missions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  /** Mission plus a short, path-free summary of its linked pod and task as they are stored right now. */
  async missionView(mission) {
    const missing = [];
    let pod = null;
    let task = null;
    if (mission.podId) {
      const instance = await readJson(this.instancePath(mission.podId));
      if (instance) pod = { id: instance.id, podName: instance.podName, templateId: instance.templateId, state: instance.state, seats: (instance.seats || []).map((seat) => ({ id: seat.id, role: seat.role })) };
      else missing.push('pod');
    }
    if (mission.taskId) {
      const record = await readJson(this.taskPath(mission.taskId));
      if (record) task = { id: record.id, podId: record.podId, seatId: record.seatId, summary: record.summary, state: record.state, evidence: record.evidence || [], updatedAt: record.updatedAt };
      else missing.push('task');
    }
    return { ...mission, pod, task, missing };
  }
  templatePath(templateId) { return path.join(this.dataDir, 'templates', assertStoredId('tpl', templateId), 'manifest.json'); }
  instancePath(podId) { return path.join(instanceDirFor(this.dataDir, podId), 'manifest.json'); }
  missionPath(missionId) { return path.join(this.dataDir, 'missions', `${assertStoredId('mission', missionId)}.json`); }
  taskPath(taskId) { return path.join(this.dataDir, 'tasks', `${assertStoredId('task', taskId)}.json`); }
}
