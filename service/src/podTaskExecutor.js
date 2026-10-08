import { spawn } from 'node:child_process';
import { AppError, badRequest, conflict, lifecycleError } from './errors.js';
import { guardDockerExecArgs, guardPrompt } from './hostDisconnectGuard.js';
import { taskPrompt } from './taskQueue.js';
import { applyStreamEvent, finalActivity, streamLineReader } from './activity.js';

export const CONTAINER_DATA_DIR = '/opt/data';
export const TASK_WORKSPACE_ROOT = `${CONTAINER_DATA_DIR}/workspaces`;
export const TASK_OUTCOMES = ['completed', 'failed', 'outcome_unknown', 'dry_run'];
export const DEFAULT_TASK_LIMITS = Object.freeze({
  turnTimeoutMs: 10 * 60 * 1000,
  maxTurns: 40,
  maxPromptChars: 16000,
  maxResponseChars: 8000,
  stdoutLimitBytes: 2 * 1024 * 1024,
  maxFiles: 16,
  maxFileBytes: 64 * 1024,
  maxTotalFileBytes: 256 * 1024,
});

const TASK_ID_RE = /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POD_ID_RE = /^pod_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEAT_ID_RE = /^[a-z][a-z0-9_-]{1,62}$/;

const RESERVED_SEAT_IDS = new Set(['hermes', 'default', 'test', 'tmp', 'root', 'sudo']);
const SESSION_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
const FILE_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const MAX_FILE_DEPTH = 4;
const KILL_AFTER_SECONDS = 2;
const HOST_TIMEOUT_MARGIN_MS = 5000;
const WORKSPACE_TIMEOUT_MS = 30000;
const WORKSPACE_OUTPUT_LIMIT = 8 * 1024;
const ERROR_TEXT_LIMIT = 200;
const NOT_STARTED_CODES = new Set([2, 125, 126, 127]);
const TIMEOUT_CODES = new Set([124, 137]);
export const MANUAL_REVIEW_NOTICE = 'Manual review of the task workspace and Hermes session is required before any retry; Waypoint never retries automatically.';

export class PodTaskExecutor {

  constructor({ config, docker, readiness, runner = tailRunner, logger = undefined, limits = {}, now = Date.now }) {
    if (typeof readiness?.check !== 'function') throw new TypeError('PodTaskExecutor requires a readiness checker');
    this.config = config;
    this.docker = docker;
    this.readiness = readiness;
    this.runner = runner;
    this.logger = logger;
    this.limits = normalizeLimits(limits);
    this.now = now;
    this.activeTasks = new Set();

    this.activeSeats = new Set();
  }

  async execute({ task, pod, template = undefined, prompt = undefined, files = [], turnLimits = undefined, guardHostDisconnect = false, activity = undefined } = {}) {
    const target = this.resolveTarget({ task, pod, prompt, files, turnLimits });
    target.guardHostDisconnect = guardHostDisconnect === true;
    target.activity = Array.isArray(activity) ? activity : [];
    if (this.config?.dryRun) return this.dryRunResult(target);
    const seatKey = `${target.podId}/${target.seatId}`;
    if (this.activeTasks.has(target.taskId)) throw conflict('task already has an active Hermes turn', { taskId: target.taskId });
    if (this.activeSeats.has(seatKey)) throw conflict('pod seat already has an active Hermes turn; wait for it to finish', { podId: target.podId, seatId: target.seatId });
    this.activeTasks.add(target.taskId);
    this.activeSeats.add(seatKey);
    try {
      const evidence = [await this.confirmReady(target, pod, template)];
      evidence.push(await this.prepareWorkspace(target));
      const turn = await this.runTurn(target);
      evidence.push(turn.evidence);
      this.logger?.info?.('pod task turn finished', { podId: target.podId, taskId: target.taskId, seatId: target.seatId, outcome: turn.outcome, durationMs: turn.durationMs });
      return { outcome: turn.outcome, text: turn.text, sessionId: turn.sessionId, durationMs: turn.durationMs, evidence, activity: finalActivity(target.activity) };
    } finally {
      this.activeTasks.delete(target.taskId);
      this.activeSeats.delete(seatKey);
    }
  }

  resolveTarget({ task, pod, prompt, files, turnLimits }) {
    if (!isPlainObject(task)) throw badRequest('task is required');
    if (!isPlainObject(pod)) throw badRequest('pod instance is required');
    const taskId = String(task.id ?? '');
    if (!TASK_ID_RE.test(taskId)) throw badRequest('invalid task id');
    const podId = String(pod.id ?? '');
    if (!POD_ID_RE.test(podId)) throw badRequest('invalid pod id');
    if (task.podId !== podId) throw conflict('task does not belong to the pod', { taskId, podId });
    const seatId = assertTaskSeatId(task.seatId);
    if (!Array.isArray(pod.seats) || !pod.seats.some((seat) => seat?.id === seatId)) throw conflict('seat does not belong to pod', { podId, seatId });
    const query = String(prompt ?? taskPrompt(task));
    if (!query.trim()) throw badRequest('task prompt is required');
    if (query.length > this.limits.maxPromptChars) throw badRequest('task prompt is too long', { maxChars: this.limits.maxPromptChars });
    if (query.includes('\0')) throw badRequest('task prompt must not contain NUL characters');
    if (turnLimits && (typeof turnLimits !== 'object' || Array.isArray(turnLimits) || Object.keys(turnLimits).some((key) => !['turnTimeoutMs', 'maxTurns'].includes(key)))) throw badRequest('invalid turn limits');
    const requestedTimeout = turnLimits?.turnTimeoutMs ?? this.limits.turnTimeoutMs;
    const requestedTurns = turnLimits?.maxTurns ?? this.limits.maxTurns;
    if (!Number.isInteger(requestedTimeout) || requestedTimeout < 5000 || requestedTimeout > this.limits.turnTimeoutMs || !Number.isInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > this.limits.maxTurns) throw badRequest('invalid turn limits');
    const timeoutSeconds = Math.ceil(requestedTimeout / 1000);
    return {
      taskId,
      podId,
      seatId,
      prompt: query,
      files: normalizeFiles(files, this.limits),
      containerName: this.docker.makeContainerName(podId),
      workspace: taskWorkspacePath(taskId),
      sessionName: taskSessionName(taskId),
      timeoutSeconds,
      runBudgetSeconds: Math.max(5, Math.floor(timeoutSeconds * 0.9)),
      maxTurns: requestedTurns,
    };
  }

  plan(target) {
    return [
      { step: 'readiness', purpose: 'confirm Waypoint-owned running pod container, seat profile, configured model, and native provider auth' },
      { step: 'workspace', command: 'docker', args: [...workspaceArgs(target.containerName).slice(0, -1), '<task workspace script>'], stdin: { taskId: target.taskId, files: target.files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content) })) } },
      { step: 'turn', command: 'docker', args: buildTaskChatArgs(target), stdin: { chars: target.prompt.length } },
    ];
  }

  dryRunResult(target) {
    return {
      outcome: 'dry_run',
      text: '',
      sessionId: null,
      durationMs: 0,
      evidence: [evidenceEntry(this.now, 'dry_run', 'Dry-run only; no pod container was inspected, no workspace was created, and no model turn ran.', { plan: this.plan(target) })],
    };
  }

  async confirmReady(target, pod, template) {
    let status;
    try { status = await this.readiness.check({ pod, seatId: target.seatId, template, containerName: target.containerName }); }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw lifecycleError('pod readiness could not be confirmed', { podId: target.podId, seatId: target.seatId });
    }
    if (status?.owned !== true) throw lifecycleError('refusing to run a task on a pod container without matching Waypoint ownership', { podId: target.podId });
    if (status.containerName !== target.containerName) throw lifecycleError('readiness check reported a different container than the owned pod container', { podId: target.podId });
    if (status.running !== true) throw conflict('pod container is not running; start the pod first', { podId: target.podId });
    const seat = status.seat;
    if (seat?.seatId !== target.seatId) throw lifecycleError('readiness check did not report the task seat', { podId: target.podId, seatId: target.seatId });
    const blockers = Array.isArray(seat.blockers) ? seat.blockers.filter((item) => typeof item === 'string').slice(0, 8) : [];
    if (!seat.provider || !seat.model) throw conflict('seat has no configured provider/model; provision the seat first', { seatId: target.seatId, blockers });
    if (seat.authenticated !== true) throw conflict('seat provider auth is not ready; no model call was made', { seatId: target.seatId, provider: String(seat.provider).slice(0, 64), blockers });
    if (seat.ready !== true || blockers.length) throw conflict('seat is not ready; no model call was made', { seatId: target.seatId, blockers });
    return evidenceEntry(this.now, 'readiness', `Owned running pod; seat ${target.seatId} ready with ${String(seat.provider).slice(0, 64)} auth.`);
  }

  async prepareWorkspace(target) {
    const input = JSON.stringify({ taskId: target.taskId, files: target.files });
    const result = await this.runner('docker', workspaceArgs(target.containerName), { input, timeoutMs: WORKSPACE_TIMEOUT_MS, outputLimitBytes: WORKSPACE_OUTPUT_LIMIT });
    if (result.timedOut) throw lifecycleError('task workspace preparation timed out; no model call was made', { taskId: target.taskId });
    if (result.code !== 0) throw lifecycleError('task workspace could not be prepared; no model call was made', { taskId: target.taskId, code: safeCode(result.code) });
    const parsed = parseJsonLine(result.stdout);
    if (parsed?.ok !== true || parsed.path !== target.workspace) {
      const reason = typeof parsed?.error === 'string' && /^[A-Za-z_]{1,64}$/.test(parsed.error) ? parsed.error : 'unexpected_output';
      if (reason === 'fixture_conflict') throw conflict('task workspace already holds a different version of a fixture file; nothing was overwritten and no model call was made. Review the workspace manually before any retry.', { taskId: target.taskId, reason });
      throw lifecycleError('task workspace could not be prepared; no model call was made', { taskId: target.taskId, reason });
    }
    const written = Number.isInteger(parsed.files) ? parsed.files : 0;
    const unchanged = Number.isInteger(parsed.unchanged) ? parsed.unchanged : 0;
    return evidenceEntry(this.now, 'workspace', `Task workspace ${target.workspace} ${parsed.created ? 'created' : 'reused'}; ${written} fixture file(s) created, ${unchanged} already present and unchanged; existing files are never overwritten.`, { fixturesCreated: written, fixturesUnchanged: unchanged });
  }

  async runTurn(target) {
    const started = this.now();
    const timeoutMs = target.timeoutSeconds * 1000 + KILL_AFTER_SECONDS * 1000 + HOST_TIMEOUT_MARGIN_MS;
    let result;
    const args = buildTaskChatArgs(target);
    try { result = await this.runner('docker', target.guardHostDisconnect ? guardDockerExecArgs(args) : args, { input: target.guardHostDisconnect ? guardPrompt(target.prompt) : target.prompt, keepStdinOpen: target.guardHostDisconnect, timeoutMs, outputLimitBytes: this.limits.stdoutLimitBytes, onStdout: streamLineReader((event) => applyStreamEvent(target.activity, event)) }); }
    catch { result = { code: null, stdout: '', timedOut: false, runnerError: true }; }
    const durationMs = Math.max(0, this.now() - started);
    const stream = parseTaskStream(result?.stdout, { maxTextChars: this.limits.maxResponseChars });
    const code = Number.isInteger(result?.code) ? result.code : null;
    const details = { exitCode: code, timedOut: Boolean(result?.timedOut) || TIMEOUT_CODES.has(code), toolCalls: stream.toolCalls };
    const finish = (outcome, text, message, extra = {}) => {
      const review = outcome === 'completed' ? {} : { retry: 'manual_review_required', automaticRetry: false };
      const note = outcome === 'completed' ? message : `${message} ${MANUAL_REVIEW_NOTICE}`;
      return { outcome, text, sessionId: stream.sessionId || null, durationMs, evidence: evidenceEntry(this.now, 'hermes_turn', note, { ...details, ...review, ...extra }) };
    };

    if (details.timedOut) {
      const where = result?.timedOut ? 'the host Docker exec timeout' : 'the in-container timeout';
      return finish('outcome_unknown', '', `Hermes turn outcome is unknown: it exceeded ${where}.`, { partialTextChars: stream.text.length, partialTextTruncated: stream.textTruncated });
    }
    if (stream.result) {
      const resultCode = Number.isInteger(stream.result.exit_code) ? stream.result.exit_code : null;
      const text = sanitizeResponse(typeof stream.result.text === 'string' ? stream.result.text : '', this.limits.maxResponseChars);
      const tokens = safeTokens(stream.result.tokens);
      const error = typeof stream.result.error === 'string' ? sanitizeResponse(stream.result.error, ERROR_TEXT_LIMIT) : '';
      if (resultCode === 0 && !error && code === 0) {
        if (text) return finish('completed', text, 'Hermes turn completed with a final assistant response.', { tokens });
        return finish('outcome_unknown', '', 'Hermes turn ended without a final assistant response.', { tokens });
      }
      return finish('failed', text, 'Hermes reported the turn as failed; side effects in the workspace may exist.', { tokens, resultExitCode: resultCode, ...(error ? { error } : {}) });
    }
    if (!stream.initialized && NOT_STARTED_CODES.has(code)) {
      return finish('failed', '', 'Hermes did not start the turn (exec or argument failure); no model call was observed.', { modelTurnStarted: false });
    }
    if (result?.runnerError || code === null) {
      return finish('outcome_unknown', '', 'Docker exec could not be supervised to completion; Hermes turn outcome is unknown.');
    }
    return finish('outcome_unknown', '', 'Hermes exited without a terminal result record; turn outcome is unknown.', { partialTextChars: stream.text.length, partialTextTruncated: stream.textTruncated });
  }
}

export function podSeatsReadiness(podSeats) {
  return {
    async check({ pod, seatId, template }) {
      const report = await podSeats.inspect(pod, { seatIds: [seatId], template, checkAuth: true });
      if (!report || report.dryRun || report.executed !== true) return { owned: false, running: false };
      const seat = Array.isArray(report.seats) ? report.seats.find((item) => item?.seatId === seatId) : undefined;
      const requested = seat?.model?.requested;
      const provider = requested?.provider || '';
      return {

        owned: true,
        running: true,
        containerName: report.containerName,
        seat: seat ? {
          seatId,
          ready: seat.ready === true,
          provider,
          model: requested?.default || '',
          authenticated: Boolean(provider) && seat.auth?.providers?.[provider]?.authenticated === true,
          blockers: Array.isArray(seat.blockers) ? seat.blockers : [],
        } : undefined,
      };
    },
  };
}

export function assertTaskSeatId(seatId) {
  const value = String(seatId ?? '');
  if (!SEAT_ID_RE.test(value) || RESERVED_SEAT_IDS.has(value)) throw badRequest('invalid seat id', { seatId: value.slice(0, 64) });
  return value;
}

export function taskWorkspacePath(taskId) {
  if (!TASK_ID_RE.test(String(taskId ?? ''))) throw badRequest('invalid task id');
  return `${TASK_WORKSPACE_ROOT}/${taskId}`;
}

export function taskSessionName(taskId) {
  if (!TASK_ID_RE.test(String(taskId ?? ''))) throw badRequest('invalid task id');
  return `waypoint-task-${taskId.slice('task_'.length)}`;
}

export function buildTaskChatArgs({ containerName, seatId, taskId, timeoutSeconds, runBudgetSeconds, maxTurns }) {
  return [
    'exec', '-i', '--user', 'hermes', containerName,
    'timeout', `--kill-after=${KILL_AFTER_SECONDS}s`, `${timeoutSeconds}s`,
    'hermes', '-p', assertTaskSeatId(seatId), 'chat',
    '--query-file', '-', '--format', 'stream-json', '--source', 'tool',
    '--in', taskWorkspacePath(taskId),
    '--continue', taskSessionName(taskId), '--create-if-missing',
    '--run-budget', String(runBudgetSeconds), '--max-turns', String(maxTurns),
  ];
}

export function parseTaskStream(stdout, { maxTextChars = DEFAULT_TASK_LIMITS.maxResponseChars } = {}) {
  const out = { sessionId: '', text: '', textTruncated: false, result: null, initialized: false, toolCalls: 0 };
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!isPlainObject(event)) continue;
    const type = event.type;
    if (type === 'tool_use') { out.toolCalls += 1; continue; }
    if (type === 'system' && event.subtype === 'init') {
      out.initialized = true;
      out.sessionId ||= safeSessionId(event.session_id);
    } else if (type === 'text' && typeof event.text === 'string' && (event.role == null || event.role === 'assistant')) {
      const room = maxTextChars - out.text.length;
      if (event.text.length > room) out.textTruncated = true;
      if (room > 0) out.text += event.text.slice(0, room);
    } else if (type === 'result') {
      out.initialized = true;
      out.result = event;
      out.sessionId = safeSessionId(event.session_id) || out.sessionId;
      break;
    }
  }
  return out;
}

export function sanitizeResponse(text, maxChars) {
  const clean = redactSensitiveText(String(text || ''))
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (clean.length <= maxChars) return clean;
  const marker = '\n[truncated]';
  return `${clean.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
}

export function redactSensitiveText(text) {
  return String(text || '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted:private-key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted:key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, '[redacted:key]')
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted:jwt]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}["']?/gi, '$1=[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)\b\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted]');
}

function normalizeFiles(files, limits) {
  if (files == null) return [];
  if (!Array.isArray(files)) throw badRequest('files must be an array');
  if (files.length > limits.maxFiles) throw badRequest('too many fixture files', { max: limits.maxFiles });
  const seen = new Set();
  let total = 0;
  const normalized = files.map((file) => {
    if (!isPlainObject(file)) throw badRequest('fixture file must be an object with path and content');
    const filePath = String(file.path ?? '');
    const segments = filePath.split('/');
    if (segments.length > MAX_FILE_DEPTH || segments.some((segment) => !FILE_SEGMENT_RE.test(segment))) throw badRequest('fixture file path must be a relative path of simple names', { path: filePath.slice(0, 128) });
    if (seen.has(filePath)) throw badRequest('duplicate fixture file path', { path: filePath });
    seen.add(filePath);
    if (typeof file.content !== 'string' || file.content.includes('\0')) throw badRequest('fixture file content must be text', { path: filePath });
    const bytes = Buffer.byteLength(file.content);
    if (bytes > limits.maxFileBytes) throw badRequest('fixture file is too large', { path: filePath, maxBytes: limits.maxFileBytes });
    total += bytes;
    if (total > limits.maxTotalFileBytes) throw badRequest('fixture files are too large in total', { maxBytes: limits.maxTotalFileBytes });
    return { path: filePath, content: file.content };
  });
  const parents = new Set(normalized.flatMap((file) => file.path.split('/').slice(0, -1).map((_, i, segs) => segs.slice(0, i + 1).join('/'))));
  const collision = normalized.find((file) => parents.has(file.path));
  if (collision) throw badRequest('fixture file path is also used as a directory', { path: collision.path });
  return normalized;
}

function normalizeLimits(overrides) {
  const pick = (key, min, max) => {
    const value = overrides?.[key] ?? DEFAULT_TASK_LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`invalid pod task limit: ${key}`);
    return value;
  };
  return {
    turnTimeoutMs: pick('turnTimeoutMs', 10000, 60 * 60 * 1000),
    maxTurns: pick('maxTurns', 1, 200),
    maxPromptChars: pick('maxPromptChars', 1, 64000),
    maxResponseChars: pick('maxResponseChars', 64, 64000),
    stdoutLimitBytes: pick('stdoutLimitBytes', 64 * 1024, 16 * 1024 * 1024),
    maxFiles: pick('maxFiles', 0, 64),
    maxFileBytes: pick('maxFileBytes', 1, 1024 * 1024),
    maxTotalFileBytes: pick('maxTotalFileBytes', 1, 4 * 1024 * 1024),
  };
}

function workspaceArgs(containerName) {
  return ['exec', '-i', '--user', 'hermes', containerName, 'python3', '-c', TASK_WORKSPACE_SCRIPT];
}

function evidenceEntry(now, type, message, extra = {}) {
  return { type, message, at: new Date(now()).toISOString(), ...extra };
}

function safeTokens(tokens) {
  if (!isPlainObject(tokens)) return undefined;
  const pickInt = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
  return { input: pickInt(tokens.input), output: pickInt(tokens.output), total: pickInt(tokens.total) };
}

function safeSessionId(value) {
  return typeof value === 'string' && SESSION_ID_RE.test(value) ? value : '';
}

function safeCode(code) {
  return Number.isInteger(code) ? code : null;
}

function parseJsonLine(stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).reverse().find((text) => text.trim().startsWith('{'));
  try {
    const parsed = JSON.parse(line);
    return isPlainObject(parsed) ? parsed : null;
  } catch { return null; }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class ByteTail {
  constructor(limit) {
    this.limit = limit;
    this.chunks = [];
    this.bytes = 0;
  }
  push(chunk) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    this.chunks.push(buffer);
    this.bytes += buffer.length;
    if (this.bytes > this.limit * 2) this.compact();
  }
  compact() {
    const joined = Buffer.concat(this.chunks);
    const tail = joined.subarray(Math.max(0, joined.length - this.limit));
    this.chunks = [tail];
    this.bytes = tail.length;
  }
  text() {
    this.compact();
    const tail = this.chunks[0];
    let start = 0;
    while (start < tail.length && start < 4 && (tail[start] & 0xc0) === 0x80) start += 1;
    return tail.subarray(start).toString('utf8');
  }
}

export function tailRunner(command, args, options = {}) {
  return new Promise((resolve) => {
    const limit = options.outputLimitBytes || WORKSPACE_OUTPUT_LIMIT;
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout = new ByteTail(limit);
    let timedOut = false;
    let settled = false;
    child.stdout.on('data', (chunk) => { stdout.push(chunk); options.onStdout?.(chunk); });
    child.stderr.on('data', () => {   });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
    }, options.timeoutMs || WORKSPACE_TIMEOUT_MS);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout: stdout.text(), timedOut });
    };
    child.on('error', () => finish({ code: 127, signal: null }));
    child.on('close', (code, signal) => finish({ code: code ?? null, signal: signal || null }));
    child.stdin.on('error', () => {});
    if (options.keepStdinOpen) child.stdin.write(options.input || '');
    else child.stdin.end(options.input || '');
  });
}

export const TASK_WORKSPACE_SCRIPT = String.raw`
import json, os, re, stat, sys
ROOT='/opt/data'
WS=ROOT+'/workspaces'
TASK_RE=re.compile(r'^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
SEG_RE=re.compile(r'^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$')
class Refused(Exception): pass
def real_dir(p, create):
 if os.path.lexists(p):
  st=os.lstat(p)
  if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode): raise Refused('not_a_directory')
  return False
 if not create: raise Refused('missing')
 os.mkdir(p,0o750)
 return True
def same_bytes(p, data):
 st=os.lstat(p)
 if not stat.S_ISREG(st.st_mode): raise Refused('not_a_file')
 if st.st_size!=len(data): return False
 fd=os.open(p, os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as h: return h.read(len(data)+1)==data
def main():
 req=json.loads(sys.stdin.read() or '{}')
 tid=str(req.get('taskId') or '')
 if not TASK_RE.match(tid): raise Refused('bad_task_id')
 files=req.get('files') or []
 if not isinstance(files,list) or len(files)>64: raise Refused('bad_files')
 plan=[]
 for f in files:
  rel=str(f.get('path') or '') if isinstance(f,dict) else ''
  segs=rel.split('/')
  content=f.get('content') if isinstance(f,dict) else None
  if not rel or len(segs)>4 or any(not SEG_RE.match(s) for s in segs) or not isinstance(content,str): raise Refused('bad_file')
  plan.append((segs, content.encode('utf-8')))
 paths={'/'.join(segs) for segs,_ in plan}
 parents={'/'.join(segs[:i]) for segs,_ in plan for i in range(1,len(segs))}
 if len(paths)!=len(plan) or paths & parents: raise Refused('bad_file')
 real_dir(ROOT, False)
 real_dir(WS, True)
 task=WS+'/'+tid
 created=real_dir(task, True)
 if os.path.realpath(task)!=task: raise Refused('workspace_escape')
 pending=[]
 unchanged=0
 for segs,data in plan:
  d=task
  missing=False
  for s in segs[:-1]:
   d=d+'/'+s
   if not os.path.lexists(d): missing=True; break
   real_dir(d, False)
  target=d+'/'+segs[-1]
  if not missing and os.path.lexists(target):
   if not same_bytes(target, data): raise Refused('fixture_conflict')
   unchanged+=1
  else: pending.append((segs,data))
 for segs,data in pending:
  d=task
  for s in segs[:-1]:
   d=d+'/'+s
   real_dir(d, True)
  fd=os.open(d+'/'+segs[-1], os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o640)
  with os.fdopen(fd,'wb') as h: h.write(data)
 return {'ok':True,'path':task,'created':created,'files':len(pending),'unchanged':unchanged}
try: out=main()
except Refused as e: out={'ok':False,'error':str(e)}
except Exception as e: out={'ok':False,'error':type(e).__name__}
sys.stdout.write('\n'+json.dumps(out)+'\n')
`;
