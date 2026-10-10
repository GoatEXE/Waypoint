import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isNotFoundError, type BoardTaskDetail, type BoardTaskLink, type OrgSeat } from '../api';
import { useSplitCols } from '../components/layout';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { AssigneeSelect } from '../components/TaskFields';
import { TaskRefText } from '../components/TaskRefText';
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

type ThreadEntry =
  | { kind: 'comment'; at: string; author: string; body: string }
  | { kind: 'event'; at: string; text: string };

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function eventText(kind: string, detail: string): string {
  const text = kind.replaceAll('_', ' ');
  return detail ? `${text}: ${detail}` : text;
}

export function threadEntries(task: BoardTaskDetail): ThreadEntry[] {
  const entries: ThreadEntry[] = [
    ...task.comments.map(c => ({ kind: 'comment' as const, at: c.at || '', author: c.author, body: c.body })),
    ...task.events.filter(e => e.kind !== 'commented').map(e => ({ kind: 'event' as const, at: e.at || '', text: eventText(e.kind, e.detail) })),
  ];
  return entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at.localeCompare(b.entry.at) || a.index - b.index)
    .map(({ entry }) => entry);
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

  const loadTask = useCallback(async () => {
    try {
      setLoad({ status: 'ready', task: await api.task(id) });
    } catch (error) {
      if (isNotFoundError(error)) setLoad({ status: 'notfound' });
      else setLoad({ status: 'error', error: errorText(error) });
    }
  }, [id]);

  useEffect(() => { setLoad({ status: 'loading' }); void loadTask(); }, [loadTask]);
  useEffect(() => { setConfirming(null); }, [id]);
  const boardKey = JSON.stringify(appState.board.find(t => t.ref === id || t.id === id) || null);
  const seenBoardKey = useRef(boardKey);
  useEffect(() => {
    if (seenBoardKey.current === boardKey) return;
    seenBoardKey.current = boardKey;
    void loadTask();
  }, [boardKey, loadTask]);
  useEffect(() => { api.orgSeats().then(r => setSeats(r.seats)).catch(() => undefined); }, []);
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
          <button className="btn lg btn-ghost" onClick={() => { setCeoThread(task.id); setPane({ open: true, tab: 'tasks' }); }}>Discuss with {ceoNameOf(appState.org.organization)}</button>
          {refreshButton}
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 36 }}>
        <div className="stack" style={{ gap: 14 }}>
          <Comment author={task.createdBy || 'user'} at={task.createdAt || ''} body={task.body || 'No description.'} />
          {threadEntries(task).map((entry, i) => entry.kind === 'comment'
            ? <Comment key={i} author={entry.author} at={entry.at} body={entry.body} />
            : <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--faint)', padding: '0 14px' }}><span>{entry.text}</span><span style={{ marginLeft: 'auto' }}>{formatDateTime(entry.at)}</span></div>)}
          {task.latestSummary && (
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
