import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isNotFoundError, type PodInstance, type StatusChange, type TaskRecord, type TaskRunRecord, type TaskRunStartResponse } from '../api';
import { podStateLabel, shortDate, taskStateLabel } from '../missionsModel';
import { OnDot } from '../components/ui';
import { useSplitCols } from '../components/layout';
import { TaskFields, draftFromTask, draftToInput, useQueueData } from '../components/TaskFields';
import { relations, reviewSentence, statusLabel, taskLabel } from '../taskQueueModel';
import { ActivityBlock, ActivityList } from '../components/Activity';
import type { TaskSummary } from '../api';
import { useStore } from '../store';
import { ceoNameOf } from '../orgModel';

type LoadState =
  | { status: 'loading'; task: null; pod: null; podError: null; error: null }
  | { status: 'ready'; task: TaskRecord; pod: PodInstance | null; podError: string | null; error: null }
  | { status: 'notfound'; task: null; pod: null; podError: null; error: null }
  | { status: 'error'; task: null; pod: null; podError: null; error: string };

type RunNotice = { kind: 'status' | 'error' | 'success'; text: string } | null;

const initialLoad: LoadState = { status: 'loading', task: null, pod: null, podError: null, error: null };
const POLL_MS = 1500;
const MAX_POLLS = 80;
const REPLY_PREVIEW_MAX = 1600;

function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return <button className="btn lg btn-ghost" onClick={onClick} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>;
}

function taskStatusOn(state: string): boolean {
  return ['running', 'review', 'in_review', 'done', 'complete', 'completed'].includes(state.toLowerCase());
}

function taskStatusSentence(task: TaskRecord): string {
  if (task.state === 'delegated') return task.seatId ? `Not started. Assigned to the ${task.seatId} seat.` : task.podId ? 'Not started. Assigned to a pod; choose a seat to run it.' : 'Not started. No pod is assigned.';
  if (task.state === 'running') return 'Running. Checking for updates.';
  if (task.state === 'completed') return 'Completed.';
  if (task.state === 'failed') return 'Run failed. Manual review required before another run.';
  if (task.state === 'outcome_unknown') return 'Run outcome unknown. Manual review required before another run.';
  return taskStateLabel(task.state);
}

function runStateLabel(state: string): string {
  if (state === 'running') return 'Running';
  if (state === 'completed') return 'Completed';
  if (state === 'failed') return 'Failed';
  if (state === 'outcome_unknown') return 'Outcome unknown';
  if (state === 'aborted') return 'Not started';
  return state ? state.charAt(0).toUpperCase() + state.slice(1).replaceAll('_', ' ') : 'Unknown';
}

function latestRun(task: TaskRecord): TaskRunRecord | null {
  const runs = Array.isArray(task.runs) ? task.runs : [];
  if (!runs.length) return null;
  return runs.find(run => run.id === task.lastRunId) || runs.at(-1) || null;
}

function isTerminalTask(task: TaskRecord): boolean {
  return task.state !== 'running' && !task.activeRunId;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDuration(ms?: number | null): string {
  if (!Number.isFinite(ms || NaN) || (ms || 0) < 0) return '';
  if ((ms || 0) < 1000) return `${ms} ms`;
  const seconds = Math.round((ms || 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function capText(text: string, max = REPLY_PREVIEW_MAX): { text: string; capped: boolean } {
  if (text.length <= max) return { text, capped: false };
  return { text: `${text.slice(0, max - 12)}\n[truncated]`, capped: true };
}

function runEvidence(task: TaskRecord, runId?: string): TaskRecord['evidence'] {
  if (!runId) return [];
  return (task.evidence || []).filter(entry => entry.runId === runId).slice(-6);
}

const ACTOR_LABEL: Record<StatusChange['by'], string> = { user: 'You', ceo: 'CEO', seat: 'Reviewer seat', system: 'Waypoint' };
const REASON_LABEL: Record<string, string> = { review: 'after reviewing the result', created: 'created the task', run_started: 'when a run started', run_completed: 'when the run completed', run_failed: 'when the run failed', run_outcome_unknown: 'when the run ended with an unknown outcome', run_aborted: 'when the run was released before starting' };

function StatusHistory({ task, ceoName }: { task: TaskRecord; ceoName: string }) {
  const history = task.statusHistory || [];
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-title">Status history</div>
      {!history.length && <div className="empty">No status changes are recorded yet.</div>}
      {history.length > 0 && <ol className="status-history">
        {[...history].reverse().map((entry, index) => (
          <li key={`${entry.at}-${index}`}>
            <span className="status-history-dot" />
            <span><strong>{entry.by === 'ceo' ? ceoName : ACTOR_LABEL[entry.by] || entry.by}</strong>{' '}
              {entry.from ? <>moved <span className="task-pill">{statusLabel(entry.from)}</span> → <span className="task-pill">{statusLabel(entry.to)}</span></> : <>set <span className="task-pill">{statusLabel(entry.to)}</span></>}
              {entry.reason && entry.reason !== 'created' && <span style={{ color: 'var(--faint)' }}> {REASON_LABEL[entry.reason] || entry.reason.replaceAll('_', ' ')}</span>}
              {entry.reason === 'created' && <span style={{ color: 'var(--faint)' }}> on create</span>}
            </span>
            <span className="act-time" style={{ marginLeft: 'auto' }} title={new Date(entry.at).toLocaleString()}>{shortDate(entry.at)}</span>
          </li>
        ))}
      </ol>}
    </div>
  );
}

function EvidenceList({ task }: { task: TaskRecord }) {
  const evidence = (task.evidence || []).filter(item => item.type !== 'record');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-title">Evidence</div>
      {!evidence.length && <div className="empty">No evidence yet. Runs and reviews add it here.</div>}
      {evidence.map((item, index) => (
        <div key={`${item.at}-${index}`} className="stack" style={{ gap: 5, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="sb-label" style={{ color: 'var(--dim)' }}>{item.type || 'record'}</span>
            <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{shortDate(item.at)}</span>
            {item.retry === 'manual_review_required' && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>manual review required</span>}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-3)' }}>{item.message}</div>
        </div>
      ))}
    </div>
  );
}

function LatestRun({ task }: { task: TaskRecord }) {
  const run = latestRun(task);
  if (!run) return <div className="empty">No runs yet.</div>;
  const reply = capText(run.reply || '');
  const evidence = runEvidence(task, run.id);
  return (
    <div className="stack" style={{ gap: 12, padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: '500 12.5px var(--mono)', color: 'var(--text)' }}>{run.id}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{runStateLabel(run.state)}</span>
        {run.reason && <span style={{ fontSize: 12, color: 'var(--faint)' }}>Reason: {run.reason.replaceAll('_', ' ')}</span>}
      </div>
      <div className="meta-row" style={{ gap: '6px 16px' }}>
        {run.startedAt && <span>Started <span className="v">{formatDateTime(run.startedAt)}</span></span>}
        {run.finishedAt && <span>Finished <span className="v">{formatDateTime(run.finishedAt)}</span></span>}
        {formatDuration(run.durationMs) && <span>Duration <span className="v">{formatDuration(run.durationMs)}</span></span>}
      </div>
      {task.liveActivity && task.liveActivity.runId === run.id
        ? (task.liveActivity.items.length ? <ActivityList items={task.liveActivity.items} /> : <div style={{ fontSize: 12, color: 'var(--faint)' }}>Waiting for the seat's first step…</div>)
        : run.activity?.length ? <ActivityBlock items={run.activity} /> : null}
      {reply.text && (
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Latest reply</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: 'var(--text-3)', maxHeight: 220, overflow: 'auto' }}>{reply.text}</div>
          {(run.replyTruncated || reply.capped) && <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Reply preview is capped.</div>}
        </div>
      )}
      {evidence.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Run evidence</div>
          {evidence.map((item, index) => (
            <div key={`${item.at}-${index}`} style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.4 }}>
              <span className="mono c-text3">{item.type || 'record'}</span>{' '}{item.message}{item.retry === 'manual_review_required' ? ' Manual review required.' : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function runButtonLabel(task: TaskRecord, starting: boolean): string {
  if (starting) return 'Starting…';
  if (task.state === 'running') return 'Running…';
  return 'Run task';
}

function canStartRun(task: TaskRecord, starting: boolean, pod: PodInstance | null): boolean {
  return !starting && task.state === 'delegated' && pod?.state === 'running';
}

function runNoticeFromStart(response: TaskRunStartResponse): RunNotice {
  if (response.dryRun) return { kind: 'status', text: 'Run check completed. No task run was started.' };
  if (response.state === 'running') return { kind: 'status', text: `Run started${response.runId ? ` (${response.runId})` : ''}. Checking for updates…` };
  return { kind: 'status', text: response.message || 'Run request accepted.' };
}

function TaskDetails({ task, queue, onSaved }: { task: TaskRecord; queue: ReturnType<typeof useQueueData>; onSaved: () => void }) {
  const [draft, setDraft] = useState(() => draftFromTask(task));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = draftFromTask(task);
  useEffect(() => { setDraft(draftFromTask(task)); }, [task.updatedAt]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.updateTask(task.id, draftToInput(draft));
      onSaved();
      void queue.reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="section-title">Details</div>
      <TaskFields draft={draft} onChange={setDraft} tasks={queue.tasks} projects={queue.projects} pods={queue.pods} selfId={task.id} savedStatus={task.status} statusLocked={task.state === 'running'}
        onProjectCreated={p => queue.setProjects(ps => [...ps, p])} disabled={busy} />
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
      {dirty && <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !draft.summary.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(saved)}>Discard</button>
      </div>}
    </div>
  );
}

function TaskLinks({ title, tasks }: { title: string; tasks: TaskSummary[] }) {
  const nav = useNavigate();
  if (!tasks.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{title}</div>
      {tasks.map(t => (
        <button key={t.id} type="button" className="task-row" style={{ borderRadius: 8, border: '1px solid var(--border)' }} onClick={() => nav('/tasks/' + encodeURIComponent(t.ref || t.id))}>
          <span className="task-ref">{taskLabel(t)}</span>
          <span className="task-title">{t.summary}</span>
          <span className="task-pill">{statusLabel(t.status)}</span>
        </button>
      ))}
    </div>
  );
}

function TaskRelations({ task, tasks }: { task: TaskRecord; tasks: TaskSummary[] }) {
  const rel = relations(task, tasks);
  const empty = !rel.parent && !rel.subtasks.length && !rel.blockedBy.length && !rel.blocking.length;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="section-title">Relationships</div>
      {empty && <div className="empty">No parent, subtasks, or blockers.</div>}
      <TaskLinks title="Parent" tasks={rel.parent ? [rel.parent] : []} />
      <TaskLinks title="Subtasks" tasks={rel.subtasks} />
      <TaskLinks title="Blocked by" tasks={rel.blockedBy} />
      <TaskLinks title="Blocking" tasks={rel.blocking} />
    </div>
  );
}

export function TaskView({ id }: { id: string }) {
  const nav = useNavigate();
  const splitCols = useSplitCols();
  const [load, setLoad] = useState<LoadState>(initialLoad);
  const queue = useQueueData();
  const { state: appState, setCeoThread, setPane } = useStore();
  const readyTaskId = load.status === 'ready' ? load.task.id : null;
  useEffect(() => { if (readyTaskId) setCeoThread(readyTaskId); }, [readyTaskId, setCeoThread]);
  const [refreshing, setRefreshing] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [retryReviewed, setRetryReviewed] = useState(false);
  const [runNotice, setRunNotice] = useState<RunNotice>(null);
  const pollTimer = useRef<number | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const loadTask = useCallback(async (mode: 'initial' | 'refresh' | 'poll' = 'initial') => {
    if (mode === 'initial') setLoad(initialLoad);
    else if (mode === 'refresh') setRefreshing(true);
    try {
      const task = await api.task(id);
      let pod: PodInstance | null = null;
      let podError: string | null = null;
      if (task.podId) {
        try {
          pod = await api.podInstance(task.podId);
        } catch (error) {
          podError = isNotFoundError(error) ? 'Linked pod record was not found.' : error instanceof Error ? error.message : String(error);
        }
      }
      setLoad({ status: 'ready', task, pod, podError, error: null });
      return task;
    } catch (error) {
      if (isNotFoundError(error)) setLoad({ status: 'notfound', task: null, pod: null, podError: null, error: null });
      else setLoad({ status: 'error', task: null, pod: null, podError: null, error: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [id]);

  const pollTask = useCallback((remaining = MAX_POLLS) => {
    clearPoll();
    pollTimer.current = window.setTimeout(async () => {
      const task = await loadTask('poll');
      if (!task) return;
      if (isTerminalTask(task)) {
        const last = latestRun(task);
        if (task.state === 'completed') setRunNotice({ kind: 'success', text: 'Run completed.' });
        else if (task.state === 'failed') setRunNotice({ kind: 'error', text: 'Run failed. Manual review is required before another run.' });
        else if (task.state === 'outcome_unknown') setRunNotice({ kind: 'error', text: 'Run outcome is unknown. Manual review is required before another run.' });
        else if (last?.state === 'aborted') setRunNotice({ kind: 'status', text: 'Run did not start. Check the latest run details.' });
        clearPoll();
        return;
      }
      if (remaining <= 1) {
        setRunNotice({ kind: 'error', text: 'Run is still in progress. Refresh later to check the outcome.' });
        clearPoll();
        return;
      }
      pollTask(remaining - 1);
    }, POLL_MS);
  }, [clearPoll, loadTask]);

  useEffect(() => {
    void loadTask();
    return clearPoll;
  }, [clearPoll, loadTask]);

  const startRun = useCallback(async (manualRetry = false) => {
    if (load.status !== 'ready') return;
    if (manualRetry ? (!retryReviewed || !['failed', 'outcome_unknown'].includes(load.task.state) || load.pod?.state !== 'running' || startingRun) : !canStartRun(load.task, startingRun, load.pod)) return;
    setStartingRun(true);
    setRunNotice({ kind: 'status', text: 'Starting run…' });
    clearPoll();
    try {
      const response = manualRetry ? await api.retryTaskAfterReview(load.task.id) : await api.runTask(load.task.id);
      if (manualRetry) setRetryReviewed(false);
      setRunNotice(runNoticeFromStart(response));
      const task = await loadTask('poll');
      if (response.state === 'running' && !response.dryRun && (!task || !isTerminalTask(task))) pollTask();
    } catch (error) {
      setRunNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      await loadTask('poll');
    } finally {
      setStartingRun(false);
    }
  }, [clearPoll, load, loadTask, pollTask, retryReviewed, startingRun]);

  if (load.status === 'loading') {
    return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">TASK</div><h1 className="h1 mono">{id}</h1><p className="lede" role="status">Loading task record…</p></div>;
  }

  if (load.status === 'notfound') {
    return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">NOT FOUND</div><h1 className="h1">Task not found</h1><p className="lede">No stored task exists for <span className="mono">{id}</span>.</p><RefreshButton loading={refreshing} onClick={() => void loadTask('refresh')} /></div>;
  }

  if (load.status === 'error') {
    return <div className="page" style={{ maxWidth: 920, gap: 14 }}><div className="eyebrow">TASK</div><h1 className="h1">Couldn't load this task</h1><p className="lede" role="alert">The Waypoint service did not answer: {load.error}</p><RefreshButton loading={refreshing} onClick={() => void loadTask('refresh')} /></div>;
  }

  const { task, pod, podError } = load;
  const startDisabledReason = task.state === 'delegated'
    ? (!task.seatId ? 'Assign a pod seat to run this task.' : pod?.state === 'running' ? '' : 'Start and prepare the pod first.')
    : task.state === 'running' ? 'A run is already in progress.' : 'Manual review is required before another run.';

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 32 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div className="page-head">
          <div className="eyebrow-row"><span>TASK</span><span className="sep">·</span><span>{taskLabel(task)}</span><span className="sep">·</span><span>{statusLabel(task.status).toUpperCase()}</span></div>
          <h1 className="h1">{task.summary}</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px', fontSize: 12.5, color: 'var(--muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><OnDot on={taskStatusOn(task.state)} /><span style={{ color: 'var(--text)' }}>{taskStateLabel(task.state)}</span></span>
            {task.seatId && <span>Seat <span className="v mono">{task.seatId}</span></span>}
            {task.podId && <span>Pod <button type="button" className="ul mono" style={{ border: 0, background: 'transparent', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }} onClick={() => nav('/pods/' + task.podId)}>{pod?.podName || task.podId}</button></span>}
            <span>Updated <span className="v">{shortDate(task.updatedAt)}</span></span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {task.state === 'delegated' && task.seatId && <button className="btn lg btn-primary" onClick={() => void startRun()} disabled={!canStartRun(task, startingRun, pod)}>{runButtonLabel(task, startingRun)}</button>}
          <button className="btn lg btn-ghost" onClick={() => { setCeoThread(task.id); setPane({ open: true, tab: 'tasks' }); }}>Discuss with {ceoNameOf(appState.org.organization)}</button>
          <RefreshButton loading={refreshing} onClick={() => void loadTask('refresh')} />
        </div>
      </div>

      {['failed', 'outcome_unknown'].includes(task.state) && (
        <div className="stack" style={{ gap: 10, padding: 18, border: '1px solid var(--border-3)', borderRadius: 12, background: 'var(--surface-2)' }}>
          <div className="section-title">Review before another run</div>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Read the latest reply and evidence below. The prior turn may have changed its workspace, so another run may repeat work. Waypoint will not retry automatically.</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
            <input type="checkbox" checked={retryReviewed} onChange={(event) => setRetryReviewed(event.target.checked)} />
            I reviewed the prior outcome and want to run this task again.
          </label>
          <div><button className="btn btn-primary" type="button" onClick={() => void startRun(true)} disabled={!retryReviewed || pod?.state !== 'running' || startingRun}>{startingRun ? 'Starting…' : 'Retry after review'}</button></div>
          {pod?.state !== 'running' && <span style={{ fontSize: 12, color: 'var(--faint)' }}>Start the pod before retrying.</span>}
        </div>
      )}

      <div className="stack" style={{ padding: '18px 20px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', gap: 6 }}>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Status</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-2)', maxWidth: 760, textWrap: 'pretty' }}>
          {taskStatusSentence(task)}
        </div>
        {task.review && reviewSentence(task.review, ceoNameOf(appState.org.organization)) && <div style={{ fontSize: 12.5, color: task.review.state === 'needs_human' ? 'var(--text)' : 'var(--text-3)' }}>{reviewSentence(task.review, ceoNameOf(appState.org.organization))}</div>}
        {startDisabledReason && <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>{startDisabledReason}</div>}
        {runNotice && <div role={runNotice.kind === 'error' ? 'alert' : 'status'} style={{ fontSize: 12.5, color: runNotice.kind === 'error' ? 'var(--text)' : 'var(--text-3)' }}>{runNotice.text}</div>}
      </div>

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 36 }}>
        <div className="stack" style={{ gap: 28 }}>
          <TaskDetails task={task} queue={queue} onSaved={() => void loadTask('poll')} />
          <StatusHistory task={task} ceoName={ceoNameOf(appState.org.organization)} />
          <EvidenceList task={task} />

          <div className="stack" style={{ gap: 12 }}>
            <div className="section-title">Runs</div>
            <LatestRun task={task} />
          </div>
        </div>

        <div className="stack" style={{ gap: 28 }}>
          <TaskRelations task={task} tasks={queue.tasks} />
          <div className="stack" style={{ gap: 10 }}>
            <div className="section-title">Assignment</div>
            <div className="kv-grid" style={{ display: 'flex', flexDirection: 'column' }}>
              {[
                ['Task state', taskStateLabel(task.state)],
                ['Assigned seat', task.seatId || 'None'],
                ['Pod record', !task.podId ? 'Unassigned' : pod ? `${pod.podName} · ${podStateLabel(pod.state)}` : (podError || 'Unavailable')],
                ['Created', shortDate(task.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="kv" style={{ padding: '10px 12px', gap: 2 }}><span className="k">{k}</span><span className="v" style={{ fontSize: 12 }}>{v}</span></div>
              ))}
            </div>
            {podError && <div style={{ fontSize: 12.5, color: 'var(--faint)' }} role="status">{podError}</div>}
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <div className="section-title">Pod seats</div>
            {!pod?.seats.length && <div className="empty">No linked pod seat list is available.</div>}
            {pod?.seats.map(seat => {
              const assigned = seat.id === task.seatId;
              return (
                <div key={seat.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, borderColor: assigned ? 'var(--border-6)' : undefined }}>
                  <OnDot on={pod.state === 'running'} />
                  <span style={{ font: '400 12px var(--mono)', color: assigned ? 'var(--text)' : 'var(--faint)' }}>{seat.id}</span>
                  <span className="ellipsis" style={{ fontSize: 12.5 }}>{seat.role}</span>
                  {assigned && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-3)' }}>assigned</span>}
                </div>
              );
            })}
          </div>

          {task.podId && <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', padding: '7px 12px', color: 'var(--text)' }} onClick={() => nav('/pods/' + task.podId)}>Open pod →</button>}
        </div>
      </div>
    </div>
  );
}
