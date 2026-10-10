import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type BoardTask } from '../api';
import { needsYou, taskLabel } from '../taskQueueModel';
import { WorkspaceHead } from '../components/ui';

function InboxItem({ task, onDone }: { task: BoardTask; onDone: () => Promise<void> }) {
  const nav = useNavigate();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = taskLabel(task);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await onDone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };
  const seat = task.assignee || 'the seat';
  const review = task.status === 'review';
  return (
    <div className="row stack" style={{ gap: 10, padding: '14px 18px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <button type="button" className="ref-link task-ref" onClick={() => nav('/tasks/' + encodeURIComponent(ref))}>{ref}</button>
        <strong style={{ fontWeight: 500 }}>{task.title}</strong>
        <span className="task-pill" style={{ marginLeft: 'auto' }}>{review ? 'In review' : 'Blocked'}</span>
      </div>
      {writing ? (
        <div className="stack" style={{ gap: 8 }}>
          <textarea className="input" rows={3} autoFocus value={text} maxLength={2000} disabled={busy} placeholder={review ? `What should ${seat} change?` : `Answer ${seat}`} onChange={e => setText(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost sm" disabled={busy} onClick={() => { setWriting(false); setText(''); }}>Cancel</button>
            <button className="btn btn-primary sm" disabled={busy || !text.trim()} onClick={() => void act(() => api.commentTask(ref, text.trim()))}>{busy ? 'Sending…' : `Send to ${seat}`}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost sm" disabled={busy} onClick={() => setWriting(true)}>{review ? 'Request changes' : 'Reply'}</button>
          <button className="btn btn-primary sm" disabled={busy} onClick={() => void act(() => api.taskAction(ref, { action: 'complete' }))}>Mark done</button>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
    </div>
  );
}

export function MessageInboxView() {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setTasks(needsYou((await api.tasks()).tasks)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 15000); return () => window.clearInterval(timer); }, [refresh]);

  return (
    <div className="page" style={{ maxWidth: 820, gap: 24 }}>
      <WorkspaceHead title="Inbox" />
      {error && <div role="alert">{error}</div>}
      {loading && <div role="status" className="empty">Loading…</div>}
      {!loading && !error && !tasks.length && <div className="empty">You're all caught up.</div>}
      {tasks.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <div className="section-title">Needs you <span className="task-count">{tasks.length}</span></div>
          {tasks.map(task => <InboxItem key={task.id} task={task} onDone={refresh} />)}
        </section>
      )}
    </div>
  );
}
