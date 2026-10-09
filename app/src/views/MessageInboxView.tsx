import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type MessageDelivery, type TaskSummary } from '../api';
import { needsYourReview, taskLabel } from '../taskQueueModel';
import { addressLabel } from '../threadTimeline';
import { ceoNameOf } from '../orgModel';
import { useStore } from '../store';

function ReviewItem({ task, onDone }: { task: TaskSummary; onDone: () => Promise<void> }) {
  const nav = useNavigate();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await onDone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };
  const seat = task.seatId || 'the seat';
  return (
    <div className="row stack" style={{ gap: 10, padding: '14px 18px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <button type="button" className="ref-link task-ref" onClick={() => nav('/tasks/' + encodeURIComponent(task.ref || task.id))}>{taskLabel(task)}</button>
        <strong style={{ fontWeight: 500 }}>{task.summary}</strong>
      </div>
      {task.review?.reason && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{task.review.reason}</div>}
      {writing ? (
        <div className="stack" style={{ gap: 8 }}>
          <textarea className="input" rows={3} autoFocus value={text} maxLength={2000} disabled={busy} placeholder={`What should ${seat} change or do next?`} onChange={e => setText(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary sm" disabled={busy || !text.trim()} onClick={() => void act(() => api.requestTaskChanges(task.id, text.trim()))}>{busy ? 'Sending…' : `Send to ${seat}`}</button>
            <button className="btn btn-ghost sm" disabled={busy} onClick={() => { setWriting(false); setText(''); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary sm" disabled={busy} title="Close the task as done. Nothing is merged or run." onClick={() => void act(() => api.updateTask(task.id, { status: 'done' }))}>Mark done</button>
          <button className="btn btn-ghost sm" disabled={busy} onClick={() => setWriting(true)}>Request changes</button>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
    </div>
  );
}

export function MessageInboxView() {
  const { state } = useStore();
  const ceoName = ceoNameOf(state.org.organization);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [failed, setFailed] = useState<MessageDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [list, deliveries] = await Promise.all([api.tasks(), api.messageDeliveries().catch(() => ({ messages: [] as MessageDelivery[] }))]);
      setTasks(needsYourReview(list.tasks));
      setFailed(deliveries.messages.filter(message => !message.readAt && ['failed', 'outcome_unknown'].includes(message.wake?.state || '')));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 15000); return () => window.clearInterval(timer); }, [refresh]);
  const dismiss = async (message: MessageDelivery) => {
    try { await api.reviewMessageDelivery(message.to, message.id); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return (
    <div className="page" style={{ maxWidth: 820, gap: 24 }}>
      <div className="page-head">
        <div className="eyebrow">INBOX</div>
        <h1 className="h1">Inbox</h1>
        <p className="lede">Things that need you.</p>
      </div>
      {error && <div role="alert">{error}</div>}
      {loading && <div role="status" className="empty">Loading…</div>}
      {!loading && !tasks.length && !failed.length && <div className="empty">You're all caught up.</div>}
      {tasks.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <div className="section-title">Needs your review <span className="task-count">{tasks.length}</span></div>
          {tasks.map(task => <ReviewItem key={task.id} task={task} onDone={refresh} />)}
        </section>
      )}
      {failed.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <div className="section-title">Messages that didn't go through <span className="task-count">{failed.length}</span></div>
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>New messages to that agent wait until you dismiss these. The agent may have acted before the result was lost.</div>
          {failed.map(message => (
            <div key={message.id} className="row" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px' }}>
              <span style={{ fontSize: 12.5 }}>To <span className="mono">{addressLabel(message.to, ceoName)}</span></span>
              <span className="ellipsis" style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1 }}>{message.text}</span>
              <button className="btn btn-ghost sm" onClick={() => void dismiss(message)}>Dismiss</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
