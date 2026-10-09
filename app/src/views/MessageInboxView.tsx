import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type MessageDelivery, type TaskSummary } from '../api';
import { needsYourReview, taskLabel } from '../taskQueueModel';

export function MessageInboxView() {
  const [messages, setMessages] = useState<MessageDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const nav = useNavigate();
  const refresh = useCallback(async () => {
    try {
      const [result, list] = await Promise.all([api.messageDeliveries(), api.tasks()]);
      setMessages(result.messages); setTasks(needsYourReview(list.tasks)); setError('');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 15000); return () => window.clearInterval(timer); }, [refresh]);
  async function review(message: MessageDelivery) {
    setReviewing(message.id);
    try { await api.reviewMessageDelivery(message.to, message.id); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setReviewing(null); }
  }
  async function settle(task: TaskSummary, status: 'done' | 'todo') {
    setReviewing(task.id);
    try { await api.updateTask(task.id, { status }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setReviewing(null); }
  }
  const attention = messages.filter(message => !message.readAt && ['failed', 'outcome_unknown'].includes(message.wake?.state || ''));
  return (
    <div className="page" style={{ maxWidth: 820, gap: 24 }}>
      <div className="page-head">
        <div className="eyebrow">INBOX</div>
        <h1 className="h1">Inbox</h1>
        <p className="lede">Finished tasks waiting for your review, then CEO and pod seat messages.</p>
      </div>
      <section className="stack" style={{ gap: 10 }}>
        <div className="section-title">Needs your review <span className="task-count">{tasks.length}</span></div>
        {!tasks.length && <div className="empty">Nothing is waiting for your review.</div>}
        {tasks.map(task => (
          <div key={task.id} className="row stack" style={{ gap: 8, padding: '14px 18px' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span className="task-ref">{taskLabel(task)}</span>
              <strong style={{ fontWeight: 500 }}>{task.summary}</strong>
            </div>
            {task.review?.reason && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{task.review.reason}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary sm" disabled={reviewing === task.id} onClick={() => void settle(task, 'done')}>Accept</button>
              <button className="btn btn-ghost sm" disabled={reviewing === task.id} onClick={() => void settle(task, 'todo')}>Reopen</button>
              <button className="btn btn-ghost sm" onClick={() => nav('/tasks/' + encodeURIComponent(task.ref || task.id))}>Open task</button>
            </div>
          </div>
        ))}
      </section>
      <div className="section-title">Message delivery</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span>{attention.length} need review</span><button className="btn btn-ghost" onClick={() => void refresh()}>Refresh</button></div>
      {error && <div role="alert">{error}</div>}
      {loading && <div role="status">Loading messages…</div>}
      {!loading && !messages.length && <div className="empty">No messages recorded.</div>}
      <div className="list">
        {messages.map(message => {
          const state = message.wake?.state || 'not scheduled';
          const needsReview = !message.readAt && ['failed', 'outcome_unknown'].includes(state);
          return <div key={message.id} className="row stack" style={{ gap: 8, padding: '16px 18px' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong>{state.replaceAll('_', ' ')}</strong>
              <span className="mono" style={{ fontSize: 12 }}>{message.from} → {message.to}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--faint)' }}>{new Date(message.createdAt).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</div>
            {message.wake?.reply && <div className="thread-peer-reply"><span className="mono">Reply</span><div className="thread-peer-text">{message.wake.reply}</div></div>}
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {message.wake?.reason && <>Reason: {message.wake.reason.replaceAll('_', ' ')} · </>}
              {state === 'queued' && message.wake?.nextAttemptAt ? `Waiting until ${new Date(message.wake.nextAttemptAt).toLocaleString()}` : `${message.wake?.attempts || 0} turn attempt(s)`}
              {message.readAt && ' · Reviewed or acknowledged'}
            </div>
            {needsReview && <div className="stack" style={{ gap: 7 }}><span style={{ fontSize: 12, color: 'var(--muted)' }}>The recipient may have acted before the result was lost. Check for a reply or other effects before closing this alert. This action does not send the message again.</span><button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={reviewing === message.id} onClick={() => void review(message)}>{reviewing === message.id ? 'Saving…' : 'Mark reviewed'}</button></div>}
          </div>;
        })}
      </div>
    </div>
  );
}
