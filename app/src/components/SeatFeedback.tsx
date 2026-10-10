import { useEffect, useRef, useState } from 'react';
import { api, type SeatFeedbackConversation } from '../api';
import { ActivityBlock, ActivityList } from './Activity';
import { TaskRefText } from './TaskRefText';
import { errorText } from '../runtimeHealth';

export function SeatFeedback({ seat, taskRef, onClose }: { seat: string; taskRef: string; onClose: () => void }) {
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
  useEffect(() => { scrollRef.current?.scrollIntoView({ block: 'nearest' }); }, [conversation?.messages.length, conversation?.live?.items.length]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true); setError(''); setDraft('');
    try { setConversation(await api.sendSeatFeedback(seat, taskRef, message)); }
    catch (e) { setError(errorText(e)); setDraft(message); }
    finally { setSending(false); }
  };

  const live = conversation?.live;
  return (
    <section className="stack seat-feedback" style={{ gap: 12 }} aria-label={`Feedback for ${seat}`}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div className="section-title">Feedback for <span className="mono">{seat}</span></div>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>A direct chat with the seat. It saves what it learns.</span>
        <button type="button" className="icon-btn" style={{ marginLeft: 'auto' }} title="Close" onClick={onClose}>×</button>
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
        <textarea className="input" rows={3} value={draft} disabled={sending} placeholder={`What should ${seat} do differently next time?`} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>{sending ? 'Waiting for reply…' : `Send to ${seat}`}</button>
        </div>
      </form>
      <div ref={scrollRef} />
    </section>
  );
}
