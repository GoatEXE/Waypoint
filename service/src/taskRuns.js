import { AppError, badRequest, conflict } from './errors.js';
import { publicActivity } from './activity.js';
import { localProjectGitEnv, podProjectMounts, projectMountTarget } from './projectMounts.js';

const START_FIELDS = new Set(['files']);
const STATUS_EVIDENCE_KEEP = 8;
const STATUS_REPLY_MAX = 4000;
export const RUN_REQUIREMENTS = 'The pod must already be running, its seat provisioned with a model, and native provider auth ready for that seat. Waypoint never starts the pod or copies CEO credentials for a task run.';

const ABORT_REASONS = [
  [/fixture/i, 'workspace_fixture_conflict'],
  [/workspace/i, 'workspace_unavailable'],
  [/active Hermes turn/i, 'seat_busy'],
  [/not running|start the pod/i, 'pod_not_running'],
  [/auth is not ready|auth_not_ready/i, 'seat_auth_not_ready'],
  [/no configured provider\/model|model_unconfigured/i, 'seat_model_unconfigured'],
  [/not ready/i, 'seat_not_ready'],
  [/ownership|refusing|unexpected image|different container/i, 'pod_safety_refused'],
];

export class TaskRunService {
  constructor({ config, store, executor, reviews = undefined, logger = undefined }) {
    this.reviews = reviews;
    this.config = config;
    this.store = store;
    this.executor = executor;
    this.logger = logger;
    this.jobs = new Map();
    this.seats = new Set();
    this.live = new Map();
  }

  liveActivity(taskId) {
    const live = this.live.get(taskId);
    return live ? { runId: live.runId, items: publicActivity(live.items) } : null;
  }

  async start(taskId, body = {}, { manualRetry = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('body must be an object');
    const unsupported = Object.keys(body).filter((key) => !START_FIELDS.has(key));
    if (unsupported.length) throw badRequest('task runs accept only optional fixture files; the prompt is the saved task summary', { fields: unsupported.slice(0, 10).map((key) => key.slice(0, 64)) });
    const files = body.files ?? [];
    const task = await this.store.getTask(taskId);
    if (!task.podId || !task.seatId) throw conflict('assign the task to a pod seat before running it', { taskId: task.id });
    if (manualRetry && !['failed', 'outcome_unknown'].includes(task.state)) throw conflict('only a failed or uncertain task run can be retried after review', { taskId: task.id, state: task.state });
    const pod = await this.store.getInstance(task.podId);
    const template = await this.resolveTemplate(pod);

    const workspace = await this.projectWorkspace(task);
    const target = this.executor.resolveTarget({ task, pod, files });

    if (this.config.dryRun) {
      const preview = await this.executor.execute({ task, pod, template, files });
      return { taskId: task.id, state: task.state, dryRun: true, executed: false, plan: preview.evidence[0]?.plan || [], message: `Dry-run only; no run was claimed and nothing was executed. ${RUN_REQUIREMENTS}` };
    }

    const seatKey = `${target.podId}/${target.seatId}`;
    if (this.jobs.has(task.id)) throw conflict('task already has a run in progress; outcome must be reviewed before any new run', { taskId: task.id, state: 'running' });
    if (this.seats.has(seatKey)) throw conflict('pod seat already has an active run; wait for it to finish', { podId: target.podId, seatId: target.seatId });
    this.seats.add(seatKey);
    let claimed;
    try { claimed = await this.store.claimTaskRun(task.id, { manualRetry }); }
    catch (error) { this.seats.delete(seatKey); throw error; }

    const { runId } = claimed;
    this.logger?.info?.('task_run_started', { taskId: task.id, runId, podId: target.podId, seatId: target.seatId });
    const job = this.dispatch(claimed.task, runId, { pod, template, files, workspace })
      .catch((error) => this.logger?.error?.('task_run_persist_failed', { taskId: task.id, runId, message: String(error?.message || error).slice(0, 200) }))
      .finally(() => {
        this.seats.delete(seatKey);
        this.jobs.delete(task.id);
      });
    this.jobs.set(task.id, job);
    return { taskId: task.id, runId, state: 'running', message: `Run claimed and executing in the background; poll the task for its outcome. ${RUN_REQUIREMENTS}` };
  }

  async projectWorkspace(task) {
    if (!task.projectId) return null;
    const project = await this.store.getProject(task.projectId).catch(() => null);
    if (project?.workspace !== 'local' || !project.localPath) return null;
    if (!podProjectMounts([project], task.podId).length) throw conflict('add this seat to the project so its pod can use the local folder', { taskId: task.id, projectId: project.id });
    const ref = `${(await this.store.taskPrefix?.()) || 'task'}-${task.number ?? task.id.slice(5, 13)}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return { source: projectMountTarget(project.id), origin: project.repo ? `https://github.com/${project.repo}.git` : '', branch: `waypoint/${ref}`, env: localProjectGitEnv(task.seatId) };
  }

  async dispatch(task, runId, { pod, template, files, workspace }) {
    let result;
    try {
      const items = [];
      this.live.set(task.id, { runId, items });
      result = await this.executor.execute({ task, pod, template, files, activity: items, workspace });
    } catch (error) {
      if (error instanceof AppError) {

        const reason = abortReason(error);
        this.logger?.info?.('task_run_aborted', { taskId: task.id, runId, reason });
        return this.store.abortTaskRun(task.id, runId, { reason });
      }
      this.logger?.error?.('task_run_unexpected_error', { taskId: task.id, runId });
      return this.store.finishTaskRun(task.id, runId, {
        outcome: 'outcome_unknown',
        text: '',
        sessionId: null,
        durationMs: null,
        evidence: [{ type: 'run_error', message: 'The run failed unexpectedly after it was claimed; the outcome is unknown. Manual review of the task workspace and Hermes session is required before any retry; Waypoint never retries automatically.', retry: 'manual_review_required', automaticRetry: false }],
      });
    }
    finally { this.live.delete(task.id); }
    if (result?.outcome === 'dry_run') return this.store.abortTaskRun(task.id, runId, { reason: 'dry_run' });
    this.logger?.info?.('task_run_finished', { taskId: task.id, runId, outcome: result.outcome, durationMs: result.durationMs });
    const reviewer = result.outcome === 'completed' && this.reviews ? await this.reviews.reviewer().catch(() => 'me') : undefined;
    const finished = await this.store.finishTaskRun(task.id, runId, result, { reviewer });
    if (finished.review?.state === 'pending') {
      await this.reviews.request(task.id).catch(async (error) => {
        this.logger?.warn?.('task_review_request_failed', { taskId: task.id, message: String(error?.message || error).slice(0, 160) });
        await this.store.recordReview(task.id, { decision: 'needs_human', reason: 'The review request could not be sent.', by: 'system' }).catch(() => undefined);
      });
    }
    return finished;
  }

  async status(taskId) {
    return publicTaskStatus(await this.store.getTask(taskId));
  }

  async settled(taskId) {
    await this.jobs.get(taskId);
  }

  async resolveTemplate(pod) {
    if (!pod.templateId) return undefined;
    return this.store.getTemplate(pod.templateId).catch((error) => {
      throw error.status === 404 ? conflict('pod template not found; seat models cannot be resolved', { podId: pod.id }) : error;
    });
  }
}

export function publicTaskStatus(task) {
  const runs = Array.isArray(task.runs) ? task.runs : [];
  const last = runs.find((run) => run?.id === task.lastRunId) || runs.at(-1);
  const reply = typeof last?.reply === 'string' ? last.reply : '';
  return {
    taskId: task.id,
    podId: task.podId,
    seatId: task.seatId,
    summary: task.summary,
    status: task.status || null,
    state: task.state,
    activeRunId: task.activeRunId || null,
    manualReviewRequired: ['failed', 'outcome_unknown'].includes(task.state),
    lastRun: last ? {
      id: last.id,
      state: last.state,
      startedAt: last.startedAt || null,
      finishedAt: last.finishedAt || null,
      durationMs: Number.isSafeInteger(last.durationMs) ? last.durationMs : null,
      reason: last.reason || null,
      sessionId: last.sessionId || null,
      reply: reply.length > STATUS_REPLY_MAX ? `${reply.slice(0, STATUS_REPLY_MAX - 12)}\n[truncated]` : reply,
      replyTruncated: Boolean(last.replyTruncated) || reply.length > STATUS_REPLY_MAX,
    } : null,
    runCount: runs.length,
    evidence: (Array.isArray(task.evidence) ? task.evidence : []).slice(-STATUS_EVIDENCE_KEEP).map((entry) => ({
      type: entry?.type,
      message: entry?.message,
      at: entry?.at,
      ...(entry?.runId ? { runId: entry.runId } : {}),
      ...(entry?.retry ? { retry: entry.retry } : {}),
    })),
    updatedAt: task.updatedAt,
  };
}

function abortReason(error) {
  const message = String(error?.message || '');
  for (const [pattern, reason] of ABORT_REASONS) if (pattern.test(message)) return reason;
  const code = String(error?.code || 'error').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  return `preflight_${/^[a-z]/.test(code) ? code : 'error'}`;
}
