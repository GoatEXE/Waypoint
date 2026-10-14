import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError, badRequest, lifecycleError, notFound, runtimeFailure } from './errors.js';
import { activityDetail } from './activity.js';

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

export function taskPullRequest(detail) {
  const handoffs = [...(detail?.events || [])].reverse().map((event) => event.payload || {});
  const texts = [detail?.latest_summary, ...handoffs.map((payload) => payload.summary)].filter((value) => typeof value === 'string');
  const urls = [...handoffs.map((payload) => payload.metadata?.published_pr).filter((url) => typeof url === 'string'), ...texts.flatMap((text) => text.match(PR_URL_RE) || [])];
  return urls[0] || null;
}

export function prContract(task) {
  const contract = task?.completion_contract;
  return typeof contract === 'string' && contract && contract !== 'local-only' ? contract : null;
}

export function contractRepo(contract) {
  if (!contract) return null;
  const match = contract.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/[1-9][0-9]*$/);
  return match ? match[1] : contract;
}

export function matchesContract(url, contract) {
  if (typeof url !== 'string' || !contract) return false;
  if (url === contract) return true;
  const repo = contractRepo(contract);
  return repo !== contract ? false : new RegExp(`^https://github\\.com/${repo.replace(/[.]/g, '\\.')}/pull/[1-9][0-9]*$`, 'i').test(url);
}

export function publishedPr(detail) {
  const contract = prContract(detail?.task);
  if (!contract) return null;
  const handoffs = [...(detail.events || [])].reverse().map((event) => event.payload || {});
  const candidates = [
    ...handoffs.map((payload) => payload.metadata?.published_pr).filter((url) => typeof url === 'string'),
    ...[detail.latest_summary, ...handoffs.map((payload) => payload.summary)].flatMap((value) => (typeof value === 'string' ? value.match(PR_URL_RE) || [] : [])),
  ];
  return candidates.find((url) => matchesContract(url, contract)) || null;
}

export function prCandidates(detail) {
  const contract = prContract(detail?.task);
  if (!contract) return [];
  const texts = [detail.latest_summary, ...(detail.events || []).map((event) => event.payload?.summary), ...(detail.comments || []).map((comment) => comment.body), detail.task?.body];
  const urls = texts.flatMap((value) => (typeof value === 'string' ? value.match(PR_URL_RE) || [] : []));
  return [...new Set(urls.filter((url) => matchesContract(url, contract)))];
}

export const PR_BOUNCE_NOTE = 'Waypoint: this task is tied to a GitHub repository, so approval needs its pull request. Hand in again with kanban_request_review and metadata {"published_pr": "<full PR URL>"}. If you have not opened the PR yet, open it first. If this work has no PR, say so in your summary and hand in again; the user will decide.';

export const PR_BOUNCE_AUTHOR = 'waypoint';

export function needsPrBounce(detail) {
  if (detail?.task?.status !== 'review' || !prContract(detail.task) || publishedPr(detail)) return false;
  return !(detail.comments || []).some((comment) => comment.author === PR_BOUNCE_AUTHOR && comment.body === PR_BOUNCE_NOTE);
}

const prMissing = (message, details) => new AppError(409, 'pr_missing', message, details);

export function boardSlug(value) {
  const result = String(value || '').trim();
  if (!BOARD_RE.test(result)) throw badRequest('board must be a board slug');
  return result;
}

const WORKER_LOG_TAIL = 128 * 1024;
const ACTIVITY_MAX = 60;
const TOOL_LINE_RE = /^\s*┊\s*(\S+)\s+(\S+)(?:\s+(.*?))?\s+(\d+(?:\.\d+)?s)\s*$/u;

export function parseWorkerLog(text, secrets = []) {
  const items = [];
  let thought = null;
  let finished = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
    if (thought) {
      if (/^\s*└─/.test(line)) {
        const detail = activityDetail(thought.join(''), secrets);
        if (detail) items.push({ kind: 'thought', detail });
        thought = null;
      } else {
        const part = line.trim();
        const previous = thought.at(-1) || '';
        thought.push(previous && !(previous.length >= 70 && /^[a-z]/.test(part)) ? ` ${part}` : part);
      }
      continue;
    }
    if (/^\s*┌─ Reasoning/.test(line)) { thought = []; continue; }
    if (/^\[kanban-worker-exit\]/.test(line)) { finished = true; continue; }
    const tool = line.match(TOOL_LINE_RE);
    if (!tool || tool[2] === 'preparing') continue;
    items.push({ kind: 'tool', icon: tool[1], name: tool[2], detail: activityDetail(tool[3] || '', secrets), duration: tool[4] });
  }
  return { items: items.slice(-ACTIVITY_MAX), finished };
}

export function parseWorkerRuns(text, secrets = []) {
  const parts = String(text || '').split(/^(?=Query: )/m).filter((part) => part.trim());
  return parts.map((part) => parseWorkerLog(part, secrets));
}

const MOVE_TASK_SCRIPT = `import json, os, sys
from hermes_cli import kanban_db as kb, projects_db as pdb
from hermes_cli.kanban_db_connect import connect_closing, write_txn
p = json.loads(sys.stdin.read())
with pdb.connect_closing() as pconn:
    project = pdb.get_project(pconn, p['project'])
if project is None:
    print(json.dumps({'error': 'project_missing'})); sys.exit(0)
with connect_closing(board=None if p['board'] == 'default' else p['board']) as conn:
    task = kb.get_task(conn, p['task'])
    if task is None:
        print(json.dumps({'error': 'task_missing'})); sys.exit(0)
    fields = {'project_id': project.id}
    if project.primary_path and task.started_at is None and task.workspace_kind == 'scratch' and task.status in ('triage', 'todo', 'ready', 'blocked'):
        fields.update(workspace_kind='worktree', workspace_path=os.path.join(project.primary_path, '.worktrees', task.id), branch_name=pdb.branch_name_for(project, task.id, title=task.title))
    with write_txn(conn):
        conn.execute('UPDATE tasks SET ' + ', '.join(k + ' = ?' for k in fields) + ' WHERE id = ?', (*fields.values(), task.id))
        kb._append_event(conn, task.id, 'edited', {'fields': sorted(fields), 'project_id': project.id})
print(json.dumps({'ok': True, 'worktree': 'workspace_kind' in fields}))`;

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

  async run(args, { json = true, board = DEFAULT_BOARD, raw = false } = {}) {
    const scoped = board && board !== DEFAULT_BOARD ? ['--board', board, ...args] : args;
    const result = await this.hermes.runner('docker', ['exec', '--user', 'hermes', this.hermes.containerName, 'hermes', 'kanban', ...scoped, ...(json ? ['--json'] : [])], { timeoutMs: 60000, outputLimitBytes: 4 * 1024 * 1024 });
    if (result.code !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim().split('\n').pop().slice(0, 200);
      if (/not found|no such task|unknown task/i.test(detail)) throw notFound('task not found');
      const failure = runtimeFailure(result);
      if (failure) throw failure;
      throw lifecycleError(`hermes kanban ${args[0]} failed${detail ? `: ${detail}` : ''}`, { code: result.code });
    }
    if (raw) return String(result.stdout || '');
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

  async projectMap() {
    return this.projects ? this.projects.byHermesId().catch(() => ({})) : {};
  }

  summary(task, numbers, prefix, board = DEFAULT_BOARD, projects = {}) {
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
      projectId: (task.project_id && projects[task.project_id]) || null,
    };
  }

  async list({ board } = {}) {
    const slugs = board ? [boardSlug(board)] : await this.boards();
    const projects = await this.projectMap();
    const prefix = await this.prefix();
    const tasks = [];
    for (const slug of slugs) {
      let rows = await this.run(['list'], { board: slug });
      if (await this.bounceUnlinkedReviews(rows, slug)) rows = await this.run(['list'], { board: slug });
      const numbers = await this.numberAll(rows.map((task) => task.id).sort(), slug);
      tasks.push(...rows.map((task) => this.summary(task, numbers, prefix, slug, projects)));
    }
    return { tasks: tasks.sort((a, b) => (b.number || 0) - (a.number || 0)) };
  }

  async bounceUnlinkedReviews(rows, board) {
    this.prChecked ||= new Set();
    let bounced = false;
    for (const row of rows) {
      if (row.status !== 'review') this.prChecked.delete(row.id);
      if (row.status !== 'review' || !prContract(row) || this.prChecked.has(row.id)) continue;
      try {
        const detail = await this.run(['show', row.id], { board });
        if (needsPrBounce(detail) && !(await this.foundPr(detail)).pr) {
          await this.run(['comment', '--author', PR_BOUNCE_AUTHOR, row.id, PR_BOUNCE_NOTE], { json: false, board });
          await this.run(['reopen-review', row.id], { json: false, board });
          bounced = true;
        }
        else this.prChecked.add(row.id);
      } catch { this.prChecked.add(row.id); }
    }
    return bounced;
  }

  async branchPullRequests(detail) {
    const repo = contractRepo(prContract(detail?.task));
    const branch = detail?.task?.branch_name;
    if (!this.github || !repo || !branch) return [];
    try {
      const { token } = await this.github.repoToken(repo);
      const result = await this.github.request(`/repos/${repo}/pulls?state=all&per_page=10&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}`, { token });
      return result.ok && Array.isArray(result.body) ? result.body.map((pr) => pr.html_url).filter((url) => matchesContract(url, prContract(detail.task))) : [];
    } catch { return []; }
  }

  async prChoices(detail) {
    return [...new Set([...prCandidates(detail), ...await this.branchPullRequests(detail)])].slice(0, 10);
  }

  async foundPr(detail) {
    if (!prContract(detail?.task)) return { pr: null, candidates: [] };
    const linked = publishedPr(detail);
    if (linked) return { pr: linked, candidates: [linked] };
    const candidates = await this.prChoices(detail);
    return { pr: candidates.length === 1 ? candidates[0] : null, candidates };
  }

  async show(ref) {
    const { id, board } = await this.locate(ref);
    const [detail, rows, runs] = await Promise.all([this.run(['show', id], { board }), this.run(['list'], { board }), this.run(['runs', id], { board }).catch(() => [])]);
    const numbers = await this.numberAll([id, ...(detail.parents || []), ...(detail.children || [])], board);
    const prefix = await this.prefix();
    const found = await this.foundPr(detail);
    const byId = new Map(rows.map((task) => [task.id, task]));
    const link = (taskId) => {
      const task = byId.get(taskId);
      return { id: taskId, ref: numbers[taskId] ? `${prefix}-${numbers[taskId]}` : null, title: task?.title || '', status: task?.status || null, assignee: task?.assignee || null };
    };
    return {
      ...this.summary(detail.task, numbers, prefix, board, await this.projectMap()),
      latestSummary: detail.latest_summary || '',
      pullRequest: found.pr || taskPullRequest(detail),
      prRepo: contractRepo(prContract(detail.task)),
      prLinked: found.pr,
      runs: (Array.isArray(runs) ? runs : []).map((run) => ({ id: run.id, profile: run.profile || null, status: run.status || null, outcome: run.outcome || null, startedAt: toIso(run.started_at), endedAt: toIso(run.ended_at), summary: run.summary || '' })),
      parents: (detail.parents || []).map(link),
      children: (detail.children || []).map(link),
      comments: (detail.comments || []).map((comment) => ({ author: comment.author, body: comment.body, at: toIso(comment.created_at) })),
      events: (detail.events || []).map((event) => ({ kind: event.kind, at: toIso(event.created_at), runId: event.run_id ?? null, detail: event.payload?.summary || event.payload?.reason || '' })),
    };
  }

  async activity(ref) {
    const { id, board } = await this.locate(ref);
    const text = await this.run(['log', id, '--tail', String(WORKER_LOG_TAIL)], { json: false, board, raw: true }).catch((error) => {
      if (error?.status === 404 || /no log for/i.test(error?.message || '')) return '';
      throw error;
    });
    const runs = parseWorkerRuns(text, [this.config.bridge?.token]);
    const last = runs.at(-1) || { items: [], finished: false };
    return { id, items: last.items, finished: last.finished, runs };
  }

  async create(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('body must be an object');
    const extra = Object.keys(input).filter((key) => !['title', 'body', 'assignee', 'parents', 'createdBy', 'board', 'project'].includes(key));
    if (extra.length) throw badRequest('unsupported task fields', { fields: extra.slice(0, 10) });
    const board = input.board ? boardSlug(input.board) : DEFAULT_BOARD;
    const args = ['create', text(input.title, 'title', TITLE_MAX)];
    const body = text(input.body, 'body', BODY_MAX, { required: false });
    if (body) args.push('--body', body);
    if (input.assignee) args.push('--assignee', profile(input.assignee, 'assignee'));
    const parents = [];
    for (const parent of Array.isArray(input.parents) ? input.parents : []) parents.push(await this.resolveId(parent));
    for (const parent of parents) args.push('--parent', parent);
    args.push('--created-by', input.createdBy === 'ceo' ? 'ceo' : 'user');
    const inherited = !input.project && parents.length ? (await this.run(['show', parents[0]], { board })).task?.project_id : null;
    args.push('--project', inherited || (await this.hermesProject(input.project)).slug);
    const created = await this.run(args, { board });
    const id = (created.task || created).id;
    await this.numberAll([id], board);
    return this.show(id);
  }

  async hermesProject(projectId) {
    if (!projectId) throw badRequest('Pick a project for this task. Use General for work without a repository.');
    if (!this.projects || !this.store) throw badRequest('projects are not available');
    const entry = await this.projects.ensure(await this.store.getProject(projectId));
    if (!entry) throw lifecycleError('Hermes could not set up this project yet. Try again in a minute.');
    return entry;
  }

  async moveToProject(id, board, projectId) {
    const entry = await this.hermesProject(projectId);
    const result = await this.hermes.execPython(MOVE_TASK_SCRIPT, JSON.stringify({ task: id, board, project: entry.hermesId }));
    const out = JSON.parse(String(result.stdout || '').trim().split('\n').pop() || '{}');
    if (out.error === 'task_missing') throw notFound('task not found');
    if (out.error === 'project_missing') throw lifecycleError('Hermes does not know this project yet. Try again in a minute.');
    if (!out.ok) throw lifecycleError('Hermes could not move the task');
  }

  async note(ref, author, body) {
    const { id, board } = await this.locate(ref);
    await this.run(['comment', '--author', author, id, text(body, 'comment', COMMENT_MAX)], { json: false, board });
  }

  async comment(ref, input = {}, { author = 'user' } = {}) {
    if (!input || typeof input !== 'object' || Object.keys(input).some((key) => key !== 'text')) throw badRequest('body must be { text }');
    const { id, board } = await this.locate(ref);
    const body = text(input.text, 'comment', COMMENT_MAX);
    const before = await this.run(['show', id], { board });
    if (before.task.status === 'review') {
      await this.run(['request-changes', id, body], { json: false, board }).catch(async (error) => {
        if (!/not in an active review run/i.test(error?.message || '')) throw error;
        await this.run(['comment', '--author', author, id, body], { json: false, board });
        await this.run(['reopen-review', id], { json: false, board });
      });
    }
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
      const contract = prContract(detail.task);
      const chosen = typeof input.pr === 'string' ? input.pr.trim() : '';
      if (chosen && !matchesContract(chosen, contract)) throw badRequest(contract ? `pr must be a pull request URL in ${contractRepo(contract)}` : 'this task does not need a pull request');
      const found = chosen ? { pr: chosen, candidates: [] } : await this.foundPr(detail);
      const pr = found.pr;
      if (contract && !pr) throw prMissing(`${detail.task.assignee || 'The seat'} didn't link a pull request. Pick or paste the PR for ${contractRepo(contract)} to approve.`, { repo: contractRepo(contract), candidates: found.candidates });
      const args = ['complete', '--summary', text(input.summary, 'summary', 500, { required: false }) || 'Marked done by the user.'];
      if (pr) args.push('--metadata', JSON.stringify({ published_pr: pr }));
      try { await this.run([...args, id], on); }
      catch (error) {
        const reason = (await this.run(['show', id], { board }).catch(() => null))?.task?.last_failure_error;
        if (contract && /published_pr/i.test(String(reason || ''))) throw prMissing(`GitHub doesn't accept ${pr} for this task. Pick or paste the PR for ${contractRepo(contract)}.`, { repo: contractRepo(contract), candidates: await this.prChoices(detail) });
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
    else if (action === 'project') await this.moveToProject(id, board, input.project);
    else throw badRequest('action must be complete, archive, block, unblock, assign, or project');
    return this.show(id);
  }
}
