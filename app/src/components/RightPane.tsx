import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { byParent, projById, st } from '../model';
import { chatContextFor, useRoute } from '../routes';
import { useStore, useViewport, type PaneTab } from '../store';
import { Dot, PaneGroupHead } from './ui';
import { PANE_DOCK_MIN } from './layout';

function messageTime(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function UserBubble({ text, meta, children }: { text: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="stack" style={{ alignSelf: 'flex-end', maxWidth: '86%', alignItems: 'flex-end', gap: 4 }}>
      <div className="bubble-you">{text}</div>
      {meta && <span style={{ fontSize: 11, color: 'var(--fainter)' }}>{meta}</span>}
      {children}
    </div>
  );
}

function CeoBubble({ text, at }: { text: string; at: string }) {
  return (
    <div className="stack" style={{ gap: 6, maxWidth: '94%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--dim)' }}>
        <div className="ceo-mark" /><span className="mono c-text3">ceo</span><span>{messageTime(at)}</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)', textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  );
}

function CeoChat() {
  const { state, loadCeoConversation, sendCeoMessage } = useStore();
  const ctx = chatContextFor(useRoute());
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const ceo = state.ceo;

  useEffect(() => {
    if (loadedRef.current || ceo.messages.length || ceo.sending || ceo.pendingMessage || ceo.failedMessage) return;
    loadedRef.current = true;
    void loadCeoConversation();
  }, [loadCeoConversation, ceo.messages.length, ceo.sending, ceo.pendingMessage, ceo.failedMessage]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ceo.messages.length, ceo.loading, ceo.sending, ceo.pendingMessage, ceo.failedMessage, ceo.sendError]);

  const send = () => {
    const text = draft.trim();
    if (!text || ceo.sending) return;
    setDraft('');
    void sendCeoMessage(text);
  };
  const refreshConversation = () => { if (!ceo.loading) void loadCeoConversation(); };
  const hasVisibleMessages = ceo.messages.length > 0 || ceo.pendingMessage || ceo.failedMessage;

  return (
    <>
      <div ref={scrollRef} className="pane-body" style={{ padding: '20px 18px', gap: 16 }} aria-live="polite">
        {ceo.loading && !ceo.messages.length && <div className="empty">Loading CEO conversation…</div>}
        {ceo.loadError && (
          <div className="empty" role="alert">
            <div>{ceo.loadError}</div>
            <button className="btn sm btn-ghost" style={{ marginTop: 10 }} onClick={loadCeoConversation}>Retry</button>
          </div>
        )}
        {!ceo.loading && !ceo.loadError && !hasVisibleMessages && (
          <div className="empty">No CEO messages yet. Send a message to start the conversation.</div>
        )}
        {ceo.messages.map((m, i) => m.role === 'user'
          ? <UserBubble key={`${m.at}-${i}`} text={m.text} meta={messageTime(m.at)} />
          : <CeoBubble key={`${m.at}-${i}`} text={m.text} at={m.at} />)}
        {ceo.pendingMessage && <UserBubble text={ceo.pendingMessage} meta="Sending…" />}
        {ceo.failedMessage && (
          <UserBubble text={ceo.failedMessage} meta="Reply not confirmed">
            <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
              {ceo.sendError && <div role="alert" style={{ fontSize: 11.5, color: 'var(--faint)', textAlign: 'right' }}>{ceo.sendError}</div>}
              <button className="btn sm btn-ghost" onClick={refreshConversation} disabled={ceo.loading}>Refresh conversation</button>
            </div>
          </UserBubble>
        )}
        {ceo.sending && !ceo.pendingMessage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--faint)' }}>
            <div className="ceo-mark" style={{ animation: 'wp-pulse 1s infinite' }} />Sending…
          </div>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
        <div className="composer">
          <textarea
            rows={2}
            value={draft}
            placeholder="Message the CEO…"
            disabled={ceo.sending}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fainter)' }}>
            <span>Context: <span className="mono" style={{ color: 'var(--muted)' }}>{ctx}</span></span>
            <button className="btn btn-primary" style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 6, fontSize: 12, opacity: draft.trim() && !ceo.sending ? 1 : 0.45 }} disabled={!draft.trim() || ceo.sending} onClick={send}>{ceo.sending ? 'Sending…' : 'Send'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

const SORD: Record<D.TaskStatus, number> = { decision: 0, blocked: 1, review: 2, running: 3, queued: 4, done: 5 };

function TasksTab() {
  const { tasks } = useStore();
  const nav = useNavigate();
  const open = tasks.filter(t => t.st !== 'done').sort((a, b) => SORD[a.st] - SORD[b.st]);
  return (
    <div className="pane-body" style={{ padding: '16px 12px', gap: 18 }}>
      {!open.length && <div className="empty">No tasks yet.</div>}
      {byParent(open, t => t.p).map(g => (
        <div key={g.key} className="stack" style={{ gap: 2 }}>
          <div style={{ padding: '4px 8px 6px' }}><PaneGroupHead g={g} /></div>
          {g.items.map(t => (
            <div key={t.id} className="sb-item" style={{ gap: 10, padding: 8, borderRadius: 7, color: 'var(--text)' }} onClick={() => nav('/tasks/' + t.id)}>
              <Dot status={t.st} />
              <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                <span className="ellipsis" style={{ fontSize: 13 }}>{t.title}</span>
                <span style={{ font: '400 11.5px var(--mono)', color: 'var(--faint)' }}>{t.id} · {t.owner}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ArtifactsTab() {
  const nav = useNavigate();
  return (
    <div className="pane-body" style={{ padding: 16, gap: 10 }}>
      {!D.paneArtifacts.length && <div className="empty">No artifacts yet.</div>}
      {byParent(D.paneArtifacts, a => a.p).map(g => (
        <div key={g.key} className="stack" style={{ gap: 8, marginBottom: 8 }}>
          <div style={{ padding: '2px 2px 0' }}><PaneGroupHead g={g} /></div>
          {g.items.map(a => (
            <div key={a.name} className="pane-card link" onClick={() => nav(a.to)}>
              {a.img && <div className="hatch" style={{ height: 120, borderBottom: '1px solid var(--border)' }}>{a.name}</div>}
              <div className="stack" style={{ padding: '10px 12px', gap: 2 }}>
                <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--faint)' }}><span className="mono">{a.kind}</span><span style={{ marginLeft: 'auto' }}>{a.src}</span></div>
                <div style={{ font: '400 12.5px var(--mono)', color: 'var(--text-3)' }}>{a.name}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function InboxTab() {
  const nav = useNavigate();
  return (
    <div className="pane-body" style={{ padding: 14, gap: 10 }}>
      <div className="empty">CEO and pod message delivery is available in the workspace inbox.</div>
      <button className="btn btn-primary" onClick={() => nav('/inbox')}>Open message delivery</button>
    </div>
  );
}

function PinnedTask({ id }: { id: string }) {
  const { tasks } = useStore();
  const nav = useNavigate();
  const t = tasks.find(x => x.id === id);
  if (!t) return <div className="pane-body" style={{ padding: '22px 20px' }}><div className="empty">This task is no longer available.</div></div>;
  const s = st(t.st);
  const project = projById(t.p);
  const blockedBy = t.st === 'blocked' || t.st === 'decision' ? t.blockedBy : undefined;
  return (
    <div className="pane-body" style={{ padding: '22px 20px', gap: 18 }}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow" style={{ letterSpacing: '.06em' }}>{t.id}{project ? ' · ' + project.name : ''}</div>
        <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.3 }}>{t.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12.5, color: 'var(--muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Dot status={t.st} /><span style={{ color: 'var(--text)' }}>{s.l}</span></span>
          <span className="mono">{t.owner}</span>
        </div>
      </div>
      <div className="stack" style={{ padding: 14, borderRadius: 10, background: 'var(--surface-3)', border: '1px solid var(--border)', gap: 4 }}>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Why this matters</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>{t.why}</div>
      </div>
      {blockedBy && <div style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '10px 12px', border: '1px dashed var(--border-6)', borderRadius: 8 }}>{blockedBy}</div>}
      {!!t.runs?.length && (
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>Runs</div>
          {t.runs.map(rid => {
            const r = D.runs[rid];
            if (!r) return null;
            const rs = st(r.st);
            return (
              <div key={rid} className="pane-card link" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, background: 'transparent' }} onClick={() => nav('/runs/' + rid)}>
                <span className="mono">{rid}</span><span style={{ color: rs.c }}>{rs.l}</span><span className="c-fainter" style={{ marginLeft: 'auto' }}>{r.when}</span>
              </div>
            );
          })}
        </div>
      )}
      <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', padding: '7px 12px', color: 'var(--text)' }} onClick={() => nav('/tasks/' + t.id)}>Open full view →</button>
    </div>
  );
}

export function RightPane() {
  const { state, setPane } = useStore();
  const vw = useViewport();
  const { tab, item } = state.pane;
  const tabs: [PaneTab, string][] = [['ceo', 'CEO'], ['tasks', 'Tasks'], ['artifacts', 'Artifacts'], ['inbox', 'Inbox']];
  if (item) tabs.push(['item', item]);

  return (
    <aside className={'pane' + (vw < PANE_DOCK_MIN ? ' overlay' : '')}>
      <div className="pane-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={'pane-tab' + (tab === k ? ' on' : '') + (k === 'item' ? ' mono' : '')} onClick={() => setPane({ tab: k })}>{label}</button>
        ))}
        <button className="icon-btn" style={{ marginLeft: 'auto' }} title="Close" onClick={() => setPane({ open: false })}>×</button>
      </div>
      {tab === 'ceo' && <CeoChat />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'artifacts' && <ArtifactsTab />}
      {tab === 'inbox' && <InboxTab />}
      {tab === 'item' && item && <PinnedTask id={item} />}
    </aside>
  );
}
