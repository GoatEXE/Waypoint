import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, isNotFoundError, type BoardTaskDetail, type TaskActivity, type TaskRun, type WorkerActivityItem } from '../api';
import { activityPollMs, groupUpdates, isUserAuthor, runActivityItems, threadEntries, type ThreadBlock } from '../taskThread';
import { ConfirmPanel } from './ConfirmPanel';
import { TaskRefText } from './TaskRefText';
import { taskLabel } from '../taskQueueModel';
import { useStore } from '../store';
import { commentPlaceholder, confirmCopy, taskPrimary, type ConfirmKind } from '../taskActionsModel';
import { errorText } from '../runtimeHealth';
import { PullRequestPreview } from './PullRequestPreview';
import { PrPicker } from './PrPicker';
import { needsPrLink, prNeededFrom, type PrNeeded } from '../prLinkModel';

export type TaskLoadState =
  | { status: 'loading' }
  | { status: 'ready'; task: BoardTaskDetail }
  | { status: 'notfound' }
  | { status: 'error'; error: string };

export function formatDateTime(iso?: string | null): string {
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

export function useTaskDetail(id: string) {
  const { state } = useStore();
  const [load, setLoad] = useState<TaskLoadState>({ status: 'loading' });

  const loadTask = useCallback(async () => {
    try {
      setLoad({ status: 'ready', task: await api.task(id) });
    } catch (error) {
      if (isNotFoundError(error)) setLoad({ status: 'notfound' });
      else setLoad({ status: 'error', error: errorText(error) });
    }
  }, [id]);

  useEffect(() => { setLoad({ status: 'loading' }); void loadTask(); }, [loadTask]);
  const boardKey = JSON.stringify(state.board.find(t => t.ref === id || t.id === id) || null);
  const seenBoardKey = useRef(boardKey);
  useEffect(() => {
    if (seenBoardKey.current === boardKey) return;
    seenBoardKey.current = boardKey;
    void loadTask();
  }, [boardKey, loadTask]);
  const pollMs = load.status === 'ready' ? activityPollMs(load.task.status) : null;
  useEffect(() => {
    if (!pollMs) return;
    const timer = window.setInterval(() => void loadTask(), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, loadTask]);
  const activity = useTaskActivity(id, load.status === 'ready' && load.task.status === 'running', load.status === 'ready' ? load.task.runs?.length || 0 : 0);
  return { load, setLoad, loadTask, activity };
}

export function useTaskActions(task: BoardTaskDetail | null, setLoad: (load: TaskLoadState) => void) {
  const { flash, loadBoard } = useStore();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [prNeeded, setPrNeeded] = useState<PrNeeded | null>(null);
  const taskId = task?.id;
  useEffect(() => { setConfirming(null); setPrNeeded(null); }, [taskId]);

  const run = async (action: () => Promise<BoardTaskDetail>) => {
    setBusy(true);
    try { setLoad({ status: 'ready', task: await action() }); setPrNeeded(null); void loadBoard(); return true; }
    catch (e) {
      const need = prNeededFrom(e);
      if (need) setPrNeeded(need);
      else flash(errorText(e));
      return false;
    }
    finally { setBusy(false); }
  };
  const confirmAction = async () => {
    if (!confirming || !task) return;
    if (await run(() => api.taskAction(taskLabel(task), { action: confirming }))) setConfirming(null);
  };
  const confirmPanel = (kind: ConfirmKind) => confirming === kind && task ? (
    <ConfirmPanel copy={confirmCopy(kind, { ref: taskLabel(task), status: task.status, assignee: task.assignee, children: task.children })} busy={busy}
      onCancel={() => setConfirming(null)} onConfirm={() => void confirmAction()} />
  ) : null;
  return { busy, run, confirming, setConfirming, confirmPanel, prNeeded, setPrNeeded };
}

export type TaskActions = ReturnType<typeof useTaskActions>;

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
    <div className="stack thread-msg theirs" style={{ gap: 6 }}>
      {items && items.length > 0 && (
        <div className="act-block">
          <button type="button" className="act-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
            <span style={{ transform: `rotate(${open ? 90 : 0}deg)`, display: 'inline-block' }}>▸</span> {run.profile || 'Seat'} · {stepsLabel(items)}
          </button>
          {open && <ActivityItems items={items} />}
        </div>
      )}
      <div className="stack" style={{ gap: 6, padding: '12px 14px', border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
        <div className="thread-msg-head">
          <span className="mono" style={{ color: 'var(--text)' }}>{run.profile || 'Seat'}</span>
          <span style={{ color: 'var(--muted)' }}>{OUTCOME_VERB[run.outcome || ''] || (run.outcome || 'ran').replaceAll('_', ' ')}</span>
          <span style={{ color: 'var(--faint)', marginLeft: 'auto' }}>{formatDateTime(run.endedAt || run.startedAt)}</span>
        </div>
        {run.summary
          ? <div className="thread-msg-body"><TaskRefText text={run.summary} /></div>
          : <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>No summary.</div>}
      </div>
    </div>
  );
}

function LiveActivity({ items, assignee }: { items: WorkerActivityItem[]; assignee: string | null }) {
  const [open, setOpen] = useState(false);
  const latest = [...items].reverse().find(item => item.kind === 'tool');
  return (
    <div className="stack worker-activity thread-msg theirs" style={{ gap: 6 }}>
      <button type="button" className="working-line act-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)} style={{ textAlign: 'left' }}>
        <span className="act-glyph running" aria-hidden="true" />
        <span>{assignee || 'The seat'} is working</span>
        {items.length > 0 && <span className="act-time">{stepsLabel(items)}</span>}
        {!open && latest && <span className="act-detail" style={{ flex: 1, minWidth: 0 }}>{latest.name === '$' ? 'run' : latest.name} {latest.detail}</span>}
        <span style={{ marginLeft: 'auto' }}>{open ? 'Hide steps' : 'Show steps'}</span>
      </button>
      {open && (items.length ? <div aria-live="polite"><ActivityItems items={items} /></div> : <div className="act-hint">Waiting for the first step…</div>)}
    </div>
  );
}

function UpdatesGroup({ entries }: { entries: Extract<ThreadBlock, { kind: 'updates' }>['entries'] }) {
  const [open, setOpen] = useState(false);
  const label = (e: (typeof entries)[number]) => e.kind === 'heartbeats' ? `${e.count} heartbeat${e.count === 1 ? '' : 's'}` : e.text;
  const last = entries[entries.length - 1];
  return (
    <div className="stack thread-updates">
      <button type="button" className="act-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span style={{ transform: `rotate(${open ? 90 : 0}deg)`, display: 'inline-block' }}>▸</span> {entries.length === 1 ? label(last) : `${entries.length} updates · ${label(last)}`}
        <span style={{ marginLeft: 12, color: 'var(--fainter)' }}>{formatDateTime(last.at)}</span>
      </button>
      {open && entries.length > 1 && entries.map((e, i) => <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--faint)', paddingLeft: 16 }}><span>{label(e)}</span><span style={{ marginLeft: 'auto' }}>{formatDateTime(e.at)}</span></div>)}
    </div>
  );
}

function Comment({ author, at, body }: { author: string; at: string; body: string }) {
  const mine = isUserAuthor(author);
  return (
    <div className={'stack thread-msg' + (mine ? ' mine' : ' theirs')} style={{ gap: 6, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: mine ? 'var(--surface-3)' : 'var(--surface)' }}>
      <div className="thread-msg-head">
        <span className="mono" style={{ color: 'var(--text)' }}>{author}</span>
        <span style={{ color: 'var(--faint)' }}>{formatDateTime(at)}</span>
      </div>
      <div className="thread-msg-body"><TaskRefText text={body} /></div>
    </div>
  );
}

export function TaskThread({ task, activity, actions, compact = false, children }: { task: BoardTaskDetail; activity: TaskActivity | null; actions: TaskActions; compact?: boolean; children?: ReactNode }) {
  const [draft, setDraft] = useState('');
  const { busy, run, setConfirming, confirmPanel, prNeeded, setPrNeeded } = actions;
  const taskId = task.id;
  useEffect(() => { setDraft(''); }, [taskId]);
  const ref = taskLabel(task);
  const closed = task.status === 'done' || task.status === 'archived';
  const inReview = task.status === 'review';
  const blocked = taskPrimary(task.status) === 'unblock';
  const items = (index: number) => runActivityItems(task.runs?.length || 0, activity?.runs || [], index);
  const submitComment = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (await run(() => api.commentTask(ref, text))) setDraft('');
  };

  return (
    <div className={'stack task-thread' + (compact ? ' compact' : '')} style={{ gap: compact ? 12 : 14 }}>
      <Comment author={task.createdBy || 'user'} at={task.createdAt || ''} body={task.body || 'No description.'} />
      {groupUpdates(threadEntries(task)).map((entry, i) => entry.kind === 'comment'
        ? <Comment key={i} author={entry.author} at={entry.at} body={entry.body} />
        : entry.kind === 'run'
        ? <RunEntry key={i} run={entry.run} items={items(entry.index)} />
        : <UpdatesGroup key={i} entries={entry.entries} />)}
      {task.status === 'running' && <LiveActivity items={activity?.items || []} assignee={task.assignee} />}
      {children}
      {task.latestSummary && !task.runs?.length && (
        <div className="stack" style={{ gap: 6, padding: '12px 14px', border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Latest summary</div>
          <div className="thread-msg-body"><TaskRefText text={task.latestSummary} /></div>
        </div>
      )}
      {task.lastError && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)', padding: '10px 12px', border: '1px dashed var(--border-6)', borderRadius: 8 }}>{task.lastError}</div>}
      {task.pullRequest && <PullRequestPreview url={task.pullRequest} />}
      {needsPrLink(task) && !prNeeded && <div role="status" style={{ fontSize: 12.5, color: 'var(--muted)', padding: '10px 12px', border: '1px dashed var(--border-6)', borderRadius: 8 }}>{task.assignee || 'The seat'} hasn't linked a pull request for {task.prRepo}. Approving will ask you to pick or paste it.</div>}
      {!closed && (
        <form className="stack task-thread-composer" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); void submitComment(); }}>
          <textarea className="input" rows={compact ? 3 : 4} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)}
            aria-label="Reply" placeholder={commentPlaceholder(task.status, task.assignee)} />
          {prNeeded ? <PrPicker need={prNeeded} busy={busy} onCancel={() => setPrNeeded(null)} onApprove={pr => void run(() => api.taskAction(ref, { action: 'complete', summary: 'Approved by the user.', pr }))} /> : confirmPanel('complete') || (
            <div className="task-thread-actions">
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
  );
}
