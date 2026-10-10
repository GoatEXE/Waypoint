import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { byParent, projById, st } from '../model';
import { api, type CeoThread } from '../api';
import { ActivityBlock, ActivityList } from './Activity';
import { TaskRefText } from './TaskRefText';
import { useStore, useViewport, type PaneTab } from '../store';
import { ceoNameOf } from '../orgModel';
import { isTaskThread, threadMeta, visibleTaskThreads } from '../ceoThreads';
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
      <div className="bubble-you"><TaskRefText text={text} /></div>
      {meta && <span style={{ fontSize: 11, color: 'var(--fainter)' }}>{meta}</span>}
      {children}
    </div>
  );
}

function CeoBubble({ text, at, name = 'CEO' }: { text: string; at: string; name?: string }) {
  return (
    <div className="stack" style={{ gap: 6, maxWidth: '94%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--dim)' }}>
        <div className="ceo-mark" /><span className="mono c-text3">{name}</span><span>{messageTime(at)}</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)', textWrap: 'pretty', whiteSpace: 'pre-wrap' }}><TaskRefText text={text} /></div>
    </div>
  );
}

function useElapsed(since: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (!since) return '';
  const seconds = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function threadName(thread: CeoThread | undefined, id: string) {
  if (id === 'general') return 'General';
  if (!thread) return 'Task thread';
  return `${thread.ref ? `${thread.ref} · ` : ''}${thread.title}`;
}

function useCeoThreads(refreshKey: unknown) {
  const [data, setData] = useState<{ threads: CeoThread[]; busyThreadId: string | null }>({ threads: [], busyThreadId: null });
  useEffect(() => {
    let active = true;
    const load = () => api.ceoThreads().then(result => { if (active) setData(result); }).catch(() => undefined);
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshKey]);
  return data;
}

function TaskThreadList({ threads, busy, onPick }: { threads: CeoThread[]; busy: string | null; onPick: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const { shown, hidden } = visibleTaskThreads(threads.filter(t => isTaskThread(t.threadId)), showAll);
  return (
    <div className="pane-body thread-list">
      {!shown.length && !hidden && <div className="empty">No tasks yet. Each new task gets its own thread with the CEO.</div>}
      {shown.map(t => (
        <button key={t.threadId} type="button" className="thread-row" onClick={() => onPick(t.threadId)}>
          <span className="thread-row-title">{busy === t.threadId && <span className="thread-row-busy" title="Working" />}<span className="ellipsis">{threadName(t, t.threadId)}</span></span>
          <span className="thread-row-meta ellipsis">{threadMeta(t)}</span>
        </button>
      ))}
      {(hidden > 0 || showAll) && <button type="button" className="thread-more" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show recent only' : `Show all (${hidden} more, incl. done)`}</button>}
    </div>
  );
}

function TasksTab() {
  const { state, setCeoThread } = useStore();
  const nav = useNavigate();
  const { threads, busyThreadId } = useCeoThreads(state.ceo.sending);
  const current = state.ceoThread;
  if (!isTaskThread(current)) return <TaskThreadList threads={threads} busy={busyThreadId} onPick={id => setCeoThread(id)} />;
  const thread = threads.find(t => t.threadId === current);
  return (
    <>
      <div className="thread-head">
        <button type="button" className="thread-back" onClick={() => setCeoThread('general')}>← Tasks</button>
        <span className="thread-head-title ellipsis">{threadName(thread, current)}</span>
        <button type="button" className="icon-btn" title="Open task" onClick={() => nav('/tasks/' + encodeURIComponent(thread?.ref || current))}>↗</button>
      </div>
      <CeoChat />
    </>
  );
}

function CeoChat() {
  const { state, loadCeoConversation, sendCeoMessage } = useStore();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const ceo = state.ceo;
  const ceoName = ceoNameOf(state.org.organization);
  const agentName = ceoName;
  const working = ceo.sending || Boolean(ceo.live);
  const elapsed = useElapsed(working ? ceo.live?.startedAt || null : null);

  useEffect(() => {
    if (loadedRef.current || ceo.messages.length || ceo.sending || ceo.pendingMessage || ceo.failedMessage) return;
    loadedRef.current = true;
    void loadCeoConversation();
  }, [loadCeoConversation, ceo.messages.length, ceo.sending, ceo.pendingMessage, ceo.failedMessage]);

  const resuming = !ceo.sending && Boolean(ceo.live);
  useEffect(() => {
    if (!resuming) return;
    const timer = window.setInterval(() => void loadCeoConversation(), 1500);
    return () => window.clearInterval(timer);
  }, [resuming, loadCeoConversation]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ceo.messages.length, ceo.loading, ceo.sending, ceo.pendingMessage, ceo.failedMessage, ceo.sendError, ceo.live?.items.length]);

  const otherBusy = !working && ceo.busyThreadId && ceo.busyThreadId !== state.ceoThread;
  const blocked = working || Boolean(otherBusy);
  const send = () => {
    const text = draft.trim();
    if (!text || blocked) return;
    setDraft('');
    void sendCeoMessage(text);
  };
  const refreshConversation = () => { if (!ceo.loading) void loadCeoConversation(); };
  const hasVisibleMessages = ceo.messages.length > 0 || ceo.pendingMessage || ceo.failedMessage;

  return (
    <>
      <div ref={scrollRef} className="pane-body" style={{ padding: '20px 18px', gap: 16 }} aria-live="polite">
        {ceo.loading && !ceo.messages.length && <div className="empty">Loading conversation…</div>}
        {ceo.loadError && (
          <div className="empty" role="alert">
            <div>{ceo.loadError}</div>
            <button className="btn sm btn-ghost" style={{ marginTop: 10 }} onClick={loadCeoConversation}>Retry</button>
          </div>
        )}
        {!ceo.loading && !ceo.loadError && !hasVisibleMessages && (
          <div className="empty">No messages yet.</div>
        )}
        {ceo.messages.map((m, i) => {
          if (m.role === 'activity') return <ActivityBlock key={`${m.at}-${i}`} items={m.items || []} />;
          if (m.role === 'user') return <UserBubble key={`${m.at}-${i}`} text={m.text || ''} meta={messageTime(m.at)} />;
          return <CeoBubble key={`${m.at}-${i}`} text={m.text || ''} at={m.at} />;
        })}
        {ceo.pendingMessage && <UserBubble text={ceo.pendingMessage} meta="Sent" />}
        {ceo.failedMessage && (
          <UserBubble text={ceo.failedMessage} meta="Reply not confirmed">
            <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
              {ceo.sendError && <div role="alert" style={{ fontSize: 11.5, color: 'var(--faint)', textAlign: 'right' }}>{ceo.sendError}</div>}
              <button className="btn sm btn-ghost" onClick={refreshConversation} disabled={ceo.loading}>Refresh conversation</button>
            </div>
          </UserBubble>
        )}
        {working && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="working-line">
              <div className="ceo-mark" style={{ animation: 'wp-pulse 1s infinite' }} />
              <span>{agentName} is working{elapsed ? ` · ${elapsed}` : ''}</span>
              {ceo.live?.items.length ? <span className="act-time">{ceo.live.items.length} step{ceo.live.items.length === 1 ? '' : 's'}</span> : null}
            </div>
            {ceo.live?.items.length ? <ActivityList items={ceo.live.items} /> : <div className="act-hint">Waiting for the first step…</div>}
          </div>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
        {otherBusy && <div className="act-hint" style={{ marginBottom: 8 }}>{ceoName} is busy in another thread.</div>}
        <div className="composer">
          <textarea
            rows={2}
            value={draft}
            placeholder={`Message ${agentName}…`}
            disabled={working}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fainter)' }}>
            <button className="btn btn-primary" style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 6, fontSize: 12, opacity: draft.trim() && !blocked ? 1 : 0.45 }} disabled={!draft.trim() || blocked} onClick={send}>{working ? 'Working…' : 'Send'}</button>
          </div>
        </div>
      </div>
    </>
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
      <div className="empty">Tasks waiting on you are in the workspace inbox.</div>
      <button className="btn btn-primary" onClick={() => nav('/inbox')}>Open inbox</button>
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
  const { state, setPane, setCeoThread } = useStore();
  const vw = useViewport();
  const { tab, item } = state.pane;
  const taskThreadOpen = isTaskThread(state.ceoThread);
  useEffect(() => { if (tab === 'ceo' && taskThreadOpen) setPane({ tab: 'tasks' }); }, [tab, taskThreadOpen, setPane]);
  const pick = (k: PaneTab) => {
    if (k === 'ceo') setCeoThread('general');
    setPane({ tab: k });
  };
  const tabs: [PaneTab, string][] = [['ceo', ceoNameOf(state.org.organization)], ['tasks', 'Tasks'], ['artifacts', 'Artifacts'], ['inbox', 'Inbox']];
  if (item) tabs.push(['item', item]);

  return (
    <aside className={'pane' + (vw < PANE_DOCK_MIN ? ' overlay' : '')}>
      <div className="pane-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={'pane-tab' + (tab === k ? ' on' : '') + (k === 'item' ? ' mono' : '')} onClick={() => pick(k)}>{label}</button>
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
