import { useEffect, useRef, useState } from 'react';
import { api, type SeatFeedbackConversation } from '../api';
import { ActivityBlock, ActivityList } from './Activity';
import { TaskRefText } from './TaskRefText';
import { errorText } from '../runtimeHealth';

export function SeatFeedback({ seat, taskRef, onClose, onSent }: { seat: string; taskRef: string; onClose: () => void; onSent?: () => void }) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [conversation, setConversation] = useState<SeatFeedbackConversation | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const load = () => api.seatFeedback(seat, taskRef).then(next => { if (active) setConversation(next); }).catch(e => { if (active) setError(errorText(e)); });
    void load();
    if (!sending) return () => { active = false; };
    const timer = window.setInterval(() => void load(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [seat, taskRef, sending]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sending, onClose]);
  useEffect(() => { scrollRef.current?.scrollIntoView({ block: 'nearest' }); }, [conversation?.messages.length, conversation?.live?.items.length]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true); setError(''); setDraft('');
    try { setConversation(await api.sendSeatFeedback(seat, taskRef, message, rating)); setRating(null); onSent?.(); }
    catch (e) { setError(errorText(e)); setDraft(message); }
    finally { setSending(false); }
  };

  const live = conversation?.live;
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget && !sending) onClose(); }}>
    <section className="modal stack seat-feedback" role="dialog" aria-modal="true" style={{ width: 560, padding: 22, gap: 12, maxHeight: '85vh', overflow: 'auto' }} aria-label={`Feedback for ${seat}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div className="stack" style={{ gap: 4 }}>
          <div className="eyebrow">FEEDBACK · {taskRef}</div>
          <h2 className="h1" style={{ fontSize: 20 }}>How did <span className="mono">{seat}</span> do?</h2>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{seat} reads this, replies, and saves what it learns. It's also added to the task's history.</span>
        </div>
        <button type="button" className="icon-btn" style={{ marginLeft: 'auto' }} title="Close" disabled={sending} onClick={onClose}>×</button>
      </div>
      {conversation?.messages.map((m, i) => m.role === 'activity'
        ? <ActivityBlock key={i} items={m.items || []} />
        : <div key={i} className={m.role === 'user' ? 'bubble-you' : 'seat-reply'} style={m.role === 'user' ? { alignSelf: 'flex-end', maxWidth: '86%' } : undefined}>
            {m.role === 'seat' && <div className="mono" style={{ fontSize: 11.5, color: 'var(--dim)', marginBottom: 4 }}>{seat}</div>}
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}><TaskRefText text={m.text || ''} /></div>
          </div>)}
      {sending && (
        <div className="stack" style={{ gap: 6 }}>
          {live?.message && <div className="bubble-you" style={{ alignSelf: 'flex-end', maxWidth: '86%', whiteSpace: 'pre-wrap' }}>{live.message}</div>}
          <div className="working-line"><span className="act-glyph running" aria-hidden="true" /><span>{seat} is thinking</span></div>
          {live?.items.length ? <ActivityList items={live.items} /> : null}
        </div>
      )}
      {error && <div role="alert" className="form-error">{error}</div>}
      <form className="stack" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); void send(); }}>
        {!conversation?.messages.length && (
          <div style={{ display: 'flex', gap: 8 }} role="radiogroup" aria-label="Rating">
            <button type="button" role="radio" aria-checked={rating === 'up'} className={'rate-btn' + (rating === 'up' ? ' on' : '')} disabled={sending} onClick={() => setRating(r => r === 'up' ? null : 'up')}>👍 Good</button>
            <button type="button" role="radio" aria-checked={rating === 'down'} className={'rate-btn' + (rating === 'down' ? ' on' : '')} disabled={sending} onClick={() => setRating(r => r === 'down' ? null : 'down')}>👎 Needs work</button>
          </div>
        )}
        <textarea className="input" rows={3} autoFocus value={draft} disabled={sending} placeholder={`Tell ${seat} what worked or what to change`} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>{sending ? 'Waiting for reply…' : `Send to ${seat}`}</button>
        </div>
      </form>
      <div ref={scrollRef} />
    </section>
    </div>
  );
}
