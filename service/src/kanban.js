import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest, lifecycleError, notFound, runtimeFailure } from './errors.js';

const TASK_ID_RE = /^t_[0-9a-f]{6,32}$/;
const REF_RE = /^([A-Z][A-Z0-9]{1,5})-([1-9][0-9]{0,8})$/;
const PROFILE_RE = /^[a-z][a-z0-9-]{1,40}$/;
const TITLE_MAX = 200;
const BODY_MAX = 8000;
const COMMENT_MAX = 4000;
const BOARD_RE = /^[a-z][a-z0-9-]{1,40}$/;
export const DEFAULT_BOARD = 'default';
export const BOARD_STATUSES = ['triage', 'todo', 'ready', 'running', 'blocked', 'review', 'done', 'archived'];

function text(value, field, max, { required = true } = {}) {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max || result.includes('\0')) throw badRequest(`${field} must be ${required ? '1' : '0'}-${max} characters`);
  return result;
}

function profile(value, field) {
  const result = String(value || '').trim();
  if (!PROFILE_RE.test(result)) throw badRequest(`${field} must be a seat id`);
  return result;
}

const PR_URL_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/[1-9][0-9]*/g;

export function publishedPr(detail) {
  const contract = detail?.task?.completion_contract;
  if (typeof contract !== 'string' || !contract || contract === 'local-only') return null;
  const handoffs = [...(detail.events || [])].reverse().map((event) => event.payload || {});
  const candidates = [
    ...handoffs.map((payload) => payload.metadata?.published_pr).filter((url) => typeof url === 'string'),
    ...[detail.latest_summary, ...handoffs.map((payload) => payload.summary)].flatMap((value) => (typeof value === 'string' ? value.match(PR_URL_RE) || [] : [])),
  ];
  return candidates.find((url) => url === contract || url.toLowerCase().startsWith(`https://github.com/${contract.toLowerCase()}/pull/`)) || null;
}

export function boardSlug(value) {
  const result = String(value || '').trim();
  if (!BOARD_RE.test(result)) throw badRequest('board must be a board slug');
  return result;
}

function toIso(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

export class KanbanBoard {
  constructor({ config, hermes, organization }) {
    this.config = config;
    this.hermes = hermes;
    this.organization = organization;
    this.refsPath = path.join(config.dataDir, 'kanban-refs.json');
    this.refsQueue = Promise.resolve();
  }

  async run(args, { json = true, board = DEFAULT_BOARD } = {}) {
    const scoped = board && board !== DEFAULT_BOARD ? ['--board', board, ...args] : args;
    const result = await this.hermes.runner('docker', ['exec', '--user', 'hermes', this.hermes.containerName, 'hermes', 'kanban', ...scoped, ...(json ? ['--json'] : [])], { timeoutMs: 60000, outputLimitBytes: 4 * 1024 * 1024 });
    if (result.code !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim().split('\n').pop().slice(0, 200);
      if (/not found|no such task|unknown task/i.test(detail)) throw notFound('task not found');
      const failure = runtimeFailure(result);
      if (failure) throw failure;
      throw lifecycleError(`hermes kanban ${args[0]} failed${detail ? `: ${detail}` : ''}`, { code: result.code });
    }
    if (!json) return null;
    const out = String(result.stdout || '').trim();
    try { return JSON.parse(out.slice(out.search(/[[{]/))); }
    catch { throw lifecycleError(`hermes kanban ${args[0]} returned unexpected output`); }
  }

  async prefix() {
    return (await this.organization?.get())?.key || 'WP';
  }

  refs(update = null) {
    const next = this.refsQueue.then(async () => {
      let state = { next: 1, numbers: {} };
      try { state = JSON.parse(await fs.readFile(this.refsPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      state.boards ||= {};
      if (update && update(state)) {
        await fs.mkdir(path.dirname(this.refsPath), { recursive: true });
        const tmp = `${this.refsPath}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(state));
        await fs.rename(tmp, this.refsPath);
      }
      return state;
    });
    this.refsQueue = next.catch(() => {});
    return next;
  }

  async numberAll(ids, board = DEFAULT_BOARD) {
    const state = await this.refs((current) => {
      let changed = false;
      for (const id of ids) {
        if (!current.numbers[id]) { current.numbers[id] = current.next; current.next += 1; changed = true; }
        if (board !== DEFAULT_BOARD && !current.boards[id]) { current.boards[id] = board; changed = true; }
      }
      return changed;
    });
    return state.numbers;
  }

  async locate(ref) {
    const value = String(ref || '').trim();
    const { numbers, boards } = await this.refs();
    if (TASK_ID_RE.test(value)) return { id: value, board: boards[value] || DEFAULT_BOARD };
    const match = value.toUpperCase().match(REF_RE);
    if (!match) throw badRequest('task must be a task id or ref');
    const number = Number(match[2]);
    const id = Object.keys(numbers).find((key) => numbers[key] === number);
    if (!id) throw notFound('task not found', { task: value.slice(0, 32) });
    return { id, board: boards[id] || DEFAULT_BOARD };
  }

  async resolveId(ref) {
    return (await this.locate(ref)).id;
  }

  async boards() {
    const boards = await this.run(['boards', 'list']);
    return boards.filter((board) => !board.archived).map((board) => board.slug || DEFAULT_BOARD);
  }

  summary(task, numbers, prefix, board = DEFAULT_BOARD) {
    const number = numbers[task.id] || null;
    return {
      id: task.id,
      number,
      ref: number ? `${prefix}-${number}` : null,
      board,
      title: task.title,
      body: task.body || '',
      status: task.status,
      assignee: task.assignee || null,
      createdBy: task.created_by || null,
      createdAt: toIso(task.created_at),
      startedAt: toIso(task.started_at),
      completedAt: toIso(task.completed_at),
      lastError: task.last_failure_error || null,
    };
  }

  async list({ board } = {}) {
    const slugs = board ? [boardSlug(board)] : await this.boards();
    const prefix = await this.prefix();
    const tasks = [];
    for (const slug of slugs) {
      const rows = await this.run(['list'], { board: slug });
      const numbers = await this.numberAll(rows.map((task) => task.id).sort(), slug);
      tasks.push(...rows.map((task) => this.summary(task, numbers, prefix, slug)));
    }
    return { tasks: tasks.sort((a, b) => (b.number || 0) - (a.number || 0)) };
  }

  async show(ref) {
    const { id, board } = await this.locate(ref);
    const [detail, rows] = await Promise.all([this.run(['show', id], { board }), this.run(['list'], { board })]);
    const numbers = await this.numberAll([id, ...(detail.parents || []), ...(detail.children || [])], board);
    const prefix = await this.prefix();
    const byId = new Map(rows.map((task) => [task.id, task]));
    const link = (taskId) => {
      const task = byId.get(taskId);
      return { id: taskId, ref: numbers[taskId] ? `${prefix}-${numbers[taskId]}` : null, title: task?.title || '', status: task?.status || null, assignee: task?.assignee || null };
    };
    return {
      ...this.summary(detail.task, numbers, prefix, board),
      latestSummary: detail.latest_summary || '',
      parents: (detail.parents || []).map(link),
      children: (detail.children || []).map(link),
      comments: (detail.comments || []).map((comment) => ({ author: comment.author, body: comment.body, at: toIso(comment.created_at) })),
      events: (detail.events || []).map((event) => ({ kind: event.kind, at: toIso(event.created_at), runId: event.run_id ?? null, detail: event.payload?.summary || event.payload?.reason || '' })),
    };
  }

  async create(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('body must be an object');
    const extra = Object.keys(input).filter((key) => !['title', 'body', 'assignee', 'parents', 'createdBy', 'board'].includes(key));
    if (extra.length) throw badRequest('unsupported task fields', { fields: extra.slice(0, 10) });
    const board = input.board ? boardSlug(input.board) : DEFAULT_BOARD;
    const args = ['create', text(input.title, 'title', TITLE_MAX)];
    const body = text(input.body, 'body', BODY_MAX, { required: false });
    if (body) args.push('--body', body);
    if (input.assignee) args.push('--assignee', profile(input.assignee, 'assignee'));
    for (const parent of Array.isArray(input.parents) ? input.parents : []) args.push('--parent', await this.resolveId(parent));
    args.push('--created-by', input.createdBy === 'ceo' ? 'ceo' : 'user');
    const created = await this.run(args, { board });
    const id = (created.task || created).id;
    await this.numberAll([id], board);
    return this.show(id);
  }

  async comment(ref, input = {}, { author = 'user' } = {}) {
    if (!input || typeof input !== 'object' || Object.keys(input).some((key) => key !== 'text')) throw badRequest('body must be { text }');
    const { id, board } = await this.locate(ref);
    const body = text(input.text, 'comment', COMMENT_MAX);
    const before = await this.run(['show', id], { board });
    if (before.task.status === 'review') await this.run(['request-changes', id, body], { json: false, board });
    else {
      await this.run(['comment', '--author', author, id, body], { json: false, board });
      if (before.task.status === 'blocked') await this.run(['unblock', '--reason', `${author} replied`, id], { json: false, board });
    }
    return this.show(id);
  }

  async act(ref, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('body must be an object');
    const { id, board } = await this.locate(ref);
    const on = { json: false, board };
    const action = String(input.action || '');
    if (action === 'complete') {
      const detail = await this.run(['show', id], { board });
      const pr = publishedPr(detail);
      const args = ['complete', '--summary', text(input.summary, 'summary', 500, { required: false }) || 'Marked done by the user.'];
      if (pr) args.push('--metadata', JSON.stringify({ published_pr: pr }));
      try { await this.run([...args, id], on); }
      catch (error) {
        const reason = (await this.run(['show', id], { board }).catch(() => null))?.task?.last_failure_error;
        throw reason ? lifecycleError(`Hermes did not complete the task: ${String(reason).slice(0, 300)}`) : error;
      }
    }
    else if (action === 'archive') {
      const [detail, rows] = await Promise.all([this.run(['show', id], { board }), this.run(['list'], { board })]);
      const waiting = new Set(rows.filter((task) => ['triage', 'todo'].includes(task.status)).map((task) => task.id));
      for (const child of detail.children || []) if (waiting.has(child)) await this.run(['archive', child], on);
      await this.run(['archive', id], on);
    }
    else if (action === 'unblock') await this.run(['unblock', id], on);
    else if (action === 'block') await this.run(['block', '--kind', 'needs_input', id, text(input.reason, 'reason', 300)], on);
    else if (action === 'assign') await this.run(['assign', id, input.assignee ? profile(input.assignee, 'assignee') : 'none'], on);
    else throw badRequest('action must be complete, archive, block, unblock, or assign');
    return this.show(id);
  }
}
