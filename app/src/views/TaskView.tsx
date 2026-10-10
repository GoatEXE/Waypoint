import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isNotFoundError, type BoardTaskDetail, type BoardTaskLink, type OrgSeat, type TaskActivity, type TaskRun, type WorkerActivityItem } from '../api';
import { activityPollMs, threadEntries } from '../taskThread';
import { useSplitCols } from '../components/layout';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { AssigneeSelect } from '../components/TaskFields';
import { TaskRefText } from '../components/TaskRefText';
import { SeatFeedback } from '../components/SeatFeedback';
import { statusLabel, taskLabel } from '../taskQueueModel';
import { useStore } from '../store';
import { ceoNameOf } from '../orgModel';
import { commentPlaceholder, confirmCopy, taskPrimary, type ConfirmKind } from '../taskActionsModel';
import { errorText } from '../runtimeHealth';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; task: BoardTaskDetail }
  | { status: 'notfound' }
  | { status: 'error'; error: string };

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function useTaskActivity(taskRef: string, running: boolean, runCount: number) {
  const [activity, setActivity] = useState<TaskActivity | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => api.taskActivity(taskRef).then(next => { if (active) setActivity(next); }).catch(() => undefined);
    void load();
    if (!running) return () => { active = false; };
    const timer = window.setInterval(() => void load(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [taskRef, running, runCount]);
  return activity;
}

function ActivityItems({ items }: { items: WorkerActivityItem[] }) {
  return (
    <div className="act-list">
      {items.map((item, i) => item.kind === 'thought'
        ? <div key={i} className="act-item act-thought" title={item.detail}><span className="act-detail">{item.detail}</span></div>
        : <div key={i} className="act-item" title={item.detail}><span className="act-glyph" aria-hidden="true">{item.icon}</span><span className="act-name">{item.name === '$' ? 'run' : item.name}</span><span className="act-detail">{item.detail}</span><span className="act-time">{item.duration}</span></div>)}
    </div>
  );
}

function stepsLabel(items: WorkerActivityItem[]) {
  const tools = items.filter(i => i.kind === 'tool').length;
  return `${tools} tool call${tools === 1 ? '' : 's'}`;
}

const OUTCOME_VERB: Record<string, string> = { review_requested: 'handed in', completed: 'finished', blocked: 'is blocked', failed: 'failed', crashed: 'stopped unexpectedly', reclaimed: 'was stopped' };

function RunEntry({ run, items }: { run: TaskRun; items: WorkerActivityItem[] | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {items && items.length > 0 && (
        <div className="act-block" style={{ padding: '0 14px' }}>
          <button type="button" className="act-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
            <span style={{ transform: `rotate(${open ? 90 : 0}deg)`, display: 'inline-block' }}>▸</span> {run.profile || 'Seat'} · {stepsLabel(items)}
          </button>
          {open && <ActivityItems items={items} />}
        </div>
      )}
      <div className="stack" style={{ gap: 6, padding: '12px 14px', border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
          <span className="mono" style={{ color: 'var(--text)' }}>{run.profile || 'Seat'}</span>
          <span style={{ color: 'var(--muted)' }}>{OUTCOME_VERB[run.outcome || ''] || (run.outcome || 'ran').replaceAll('_', ' ')}</span>
          <span style={{ color: 'var(--faint)', marginLeft: 'auto' }}>{formatDateTime(run.endedAt || run.startedAt)}</span>
        </div>
        {run.summary
          ? <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}><TaskRefText text={run.summary} /></div>
          : <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>No summary.</div>}
      </div>
    </div>
  );
}

function LiveActivity({ items, assignee }: { items: WorkerActivityItem[]; assignee: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(-8);
  return (
    <div className="stack worker-activity" style={{ gap: 6 }}>
      <div className="working-line">
        <span className="act-glyph running" aria-hidden="true" />
        <span>{assignee || 'The seat'} is working</span>
        {items.length > 0 && <span className="act-time">{stepsLabel(items)}</span>}
        {items.length > 8 && <button type="button" className="act-toggle" style={{ marginLeft: 'auto' }} onClick={() => setShowAll(v => !v)}>{showAll ? 'Show latest' : `Show all ${items.length}`}</button>}
      </div>
      {items.length ? <div aria-live="polite"><ActivityItems items={shown} /></div> : <div className="act-hint">Waiting for the first step…</div>}
    </div>
  );
}

function TaskLinks({ title, links }: { title: string; links: BoardTaskLink[] }) {
  const nav = useNavigate();
  if (!links.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{title}</div>
      {links.map(link => (
        <span key={link.id} style={{ fontSize: 12.5 }}>
          <button type="button" className="ref-link" onClick={() => nav('/tasks/' + encodeURIComponent(link.ref || link.id))}>{link.ref || link.id}</button> {link.title}
          {link.assignee && <span style={{ color: 'var(--muted)' }}> · {link.assignee}</span>}
        </span>
      ))}
    </div>
  );
}

function Comment({ author, at, body }: { author: string; at: string; body: string }) {
  return (
    <div className="stack" style={{ gap: 6, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
        <span className="mono" style={{ color: 'var(--text)' }}>{author}</span>
        <span style={{ color: 'var(--faint)' }}>{formatDateTime(at)}</span>
      </div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}><TaskRefText text={body} /></div>
    </div>
  );
}

export function TaskView({ id }: { id: string }) {
  const nav = useNavigate();
  const splitCols = useSplitCols();
  const { state: appState, setCeoThread, setPane, flash, loadBoard } = useStore();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [seats, setSeats] = useState<OrgSeat[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [feedback, setFeedback] = useState(false);

  const loadTask = useCallback(async () => {
    try {
      setLoad({ status: 'ready', task: await api.task(id) });
    } catch (error) {
      if (isNotFoundError(error)) setLoad({ status: 'notfound' });
      else setLoad({ status: 'error', error: errorText(error) });
    }
  }, [id]);

  useEffect(() => { setLoad({ status: 'loading' }); void loadTask(); }, [loadTask]);
  useEffect(() => { setConfirming(null); setFeedback(false); }, [id]);
  const boardKey = JSON.stringify(appState.board.find(t => t.ref === id || t.id === id) || null);
  const seenBoardKey = useRef(boardKey);
  useEffect(() => {
    if (seenBoardKey.current === boardKey) return;
    seenBoardKey.current = boardKey;
    void loadTask();
  }, [boardKey, loadTask]);
  useEffect(() => { api.orgSeats().then(r => setSeats(r.seats)).catch(() => undefined); }, []);
  const pollMs = load.status === 'ready' ? activityPollMs(load.task.status) : null;
  const activity = useTaskActivity(id, load.status === 'ready' && load.task.status === 'running', load.status === 'ready' ? load.task.runs?.length || 0 : 0);
  useEffect(() => {
    if (!pollMs) return;
    const timer = window.setInterval(() => void loadTask(), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, loadTask]);
  const readyTaskId = load.status === 'ready' ? load.task.id : null;
  useEffect(() => { if (readyTaskId) setCeoThread(readyTaskId); }, [readyTaskId, setCeoThread]);

  const refresh = async () => { setRefreshing(true); await Promise.all([loadTask(), loadBoard()]); setRefreshing(false); };
  const run = async (action: () => Promise<BoardTaskDetail>) => {
    setBusy(true);
    try { setLoad({ status: 'ready', task: await action() }); void loadBoard(); return true; }
    catch (e) { flash(errorText(e)); return false; }
    finally { setBusy(false); }
  };

  const refreshButton = <button className="btn lg btn-ghost" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>;
  if (load.status === 'loading') return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">TASK</div><h1 className="h1 mono">{id}</h1><p className="lede" role="status">Loading task…</p></div>;
  if (load.status === 'notfound') return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">NOT FOUND</div><h1 className="h1">Task not found</h1><p className="lede">No task exists for <span className="mono">{id}</span>.</p>{refreshButton}</div>;
  if (load.status === 'error') return <div className="page" style={{ maxWidth: 920, gap: 14 }}><div className="eyebrow">TASK</div><h1 className="h1">Couldn't load this task</h1><p className="lede" role="alert">{load.error}</p>{refreshButton}</div>;

  const { task } = load;
  const runs = task.runs || [];
  const activityRuns = activity?.runs || [];
  const runItems = (index: number) => activityRuns[activityRuns.length - (runs.length - index)]?.items || null;
  const ref = taskLabel(task);
  const closed = task.status === 'done' || task.status === 'archived';
  const inReview = task.status === 'review';
  const blocked = taskPrimary(task.status) === 'unblock';
  const submitComment = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (await run(() => api.commentTask(ref, text))) setDraft('');
  };
  const confirmAction = async () => {
    if (!confirming) return;
    if (await run(() => api.taskAction(ref, { action: confirming }))) setConfirming(null);
  };
  const confirmPanel = (kind: ConfirmKind) => confirming === kind && (
    <ConfirmPanel copy={confirmCopy(kind, { ref, status: task.status, assignee: task.assignee, children: task.children })} busy={busy}
      onCancel={() => setConfirming(null)} onConfirm={() => void confirmAction()} />
  );

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 28 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div className="page-head">
          <div className="eyebrow-row"><span>TASK</span><span className="sep">·</span><span>{ref}</span><span className="sep">·</span><span>{statusLabel(task.status).toUpperCase()}</span>{task.board !== 'default' && <><span className="sep">·</span><button type="button" className="ref-link" onClick={() => nav('/pods/' + task.board.replace(/^pod-/, ''))}>POD {task.board.replace(/^pod-/, '').toUpperCase()}</button></>}</div>
          <h1 className="h1">{task.title}</h1>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {task.assignee && <button className="btn lg btn-ghost" onClick={() => setFeedback(true)}>Give {task.assignee} feedback</button>}
          <button className="btn lg btn-ghost" onClick={() => { setCeoThread(task.id); setPane({ open: true, tab: 'tasks' }); }}>Discuss with {ceoNameOf(appState.org.organization)}</button>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 36 }}>
        <div className="stack" style={{ gap: 14 }}>
          <Comment author={task.createdBy || 'user'} at={task.createdAt || ''} body={task.body || 'No description.'} />
          {threadEntries(task).map((entry, i) => entry.kind === 'comment'
            ? <Comment key={i} author={entry.author} at={entry.at} body={entry.body} />
            : entry.kind === 'run'
            ? <RunEntry key={i} run={entry.run} items={runItems(entry.index)} />
            : <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--faint)', padding: '0 14px' }}><span>{entry.kind === 'heartbeats' ? `${entry.count} heartbeat${entry.count === 1 ? '' : 's'} · latest` : entry.text}</span><span style={{ marginLeft: 'auto' }}>{formatDateTime(entry.at)}</span></div>)}
          {task.status === 'running' && <LiveActivity items={activity?.items || []} assignee={task.assignee} />}
          {feedback && task.assignee && <SeatFeedback seat={task.assignee} taskRef={ref} onClose={() => setFeedback(false)} />}
          {task.latestSummary && !task.runs?.length && (
            <div className="stack" style={{ gap: 6, padding: '12px 14px', border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Latest summary</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}><TaskRefText text={task.latestSummary} /></div>
            </div>
          )}
          {task.lastError && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)', padding: '10px 12px', border: '1px dashed var(--border-6)', borderRadius: 8 }}>{task.lastError}</div>}
          {!closed && (
            <form className="stack" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); void submitComment(); }}>
              <textarea className="input" rows={4} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)}
                placeholder={commentPlaceholder(task.status, task.assignee)} />
              {confirmPanel('complete') || (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  {inReview
                    ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(() => api.taskAction(ref, { action: 'complete', summary: 'Approved by the user.' }))}>Approve</button>
                    : <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming('complete')}>Mark done</button>}
                  {blocked
                    ? draft.trim()
                      ? <button type="submit" className="btn btn-primary" disabled={busy}>Reply and unblock</button>
                      : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => api.taskAction(ref, { action: 'unblock' }))}>Unblock</button>
                    : <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>{inReview ? 'Request changes' : 'Comment'}</button>}
                </div>
              )}
            </form>
          )}
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <label className="field"><span className="field-label">Assignee</span>
            <AssigneeSelect value={task.assignee || ''} seats={seats} disabled={busy || closed} onChange={v => void run(() => api.taskAction(ref, { action: 'assign', assignee: v || null }))} />
          </label>
          <div className="kv-grid" style={{ display: 'flex', flexDirection: 'column' }}>
            {([
              ['Status', statusLabel(task.status)],
              ['Created', formatDateTime(task.createdAt)],
              ['Started', formatDateTime(task.startedAt)],
              ['Completed', formatDateTime(task.completedAt)],
            ] as const).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="kv" style={{ padding: '10px 12px', gap: 2 }}><span className="k">{k}</span><span className="v" style={{ fontSize: 12 }}>{v}</span></div>
            ))}
          </div>
          <TaskLinks title="Waits on" links={task.parents} />
          <TaskLinks title="Starts after this" links={task.children} />
          {task.status !== 'archived' && (confirmPanel('archive') || <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => setConfirming('archive')}>Archive</button>)}
        </div>
      </div>
    </div>
  );
}
