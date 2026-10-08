import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { byParent, projById, st } from '../model';
import { api, parseSeatThread, type CeoThread } from '../api';
import { ActivityBlock, ActivityList } from './Activity';
import { addressLabel, buildTimeline, deliveryLabel, generalThreadMessages, type TaskThreadExtras, type TimelineEntry } from '../threadTimeline';
import { useStore, useViewport, type PaneTab } from '../store';
import { ceoNameOf } from '../orgModel';
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

function CeoBubble({ text, at, name = 'ceo' }: { text: string; at: string; name?: string }) {
  return (
    <div className="stack" style={{ gap: 6, maxWidth: '94%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--dim)' }}>
        <div className="ceo-mark" /><span className="mono c-text3">{name}</span><span>{messageTime(at)}</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)', textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>{text}</div>
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

function ThreadBar({ threads, current, busy, disabled, onPick }: { threads: CeoThread[]; current: string; busy: string | null; disabled: boolean; onPick: (id: string) => void }) {
  const nav = useNavigate();
  const known = threads.some(t => t.threadId === current) ? threads : [...threads, { threadId: current, title: current === 'general' ? 'General' : parseSeatThread(current)?.seatId || 'Task thread', ref: null, status: null, messageCount: 0, updatedAt: null, lastText: '' }];
  const groups: [string, CeoThread[]][] = [
    ['Tasks', known.filter(t => t.threadId.startsWith('task_'))],
    ['Seats', known.filter(t => t.threadId.startsWith('seat:'))],
  ];
  const option = (t: CeoThread) => <option key={t.threadId} value={t.threadId}>{threadName(t, t.threadId)}{busy === t.threadId ? ' (working)' : ''}</option>;
  const seat = parseSeatThread(current);
  const thread = known.find(t => t.threadId === current);
  return (
    <div className="thread-bar">
      <span className="thread-label">THREAD</span>
      <select className="thread-select" value={current} disabled={disabled} onChange={e => onPick(e.target.value)} aria-label="Conversation thread">
        {known.filter(t => t.threadId === 'general').map(option)}
        {groups.map(([label, list]) => list.length ? <optgroup key={label} label={label}>{list.map(option)}</optgroup> : null)}
      </select>
      {seat && <button type="button" className="icon-btn" title="Open pod" onClick={() => nav('/pods/' + seat.podId)}>↗</button>}
      {current.startsWith('task_') && <button type="button" className="icon-btn" title="Open task" onClick={() => nav('/tasks/' + encodeURIComponent(thread?.ref || current))}>↗</button>}
    </div>
  );
}

function runLabel(state: string) {
  if (state === 'running') return 'running';
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (state === 'outcome_unknown') return 'outcome unknown';
  return state.replaceAll('_', ' ');
}

function RunEntry({ entry, seatId }: { entry: Extract<TimelineEntry, { kind: 'run' }>; seatId: string | null }) {
  const { run, live } = entry;
  const seconds = run.durationMs != null ? Math.round(run.durationMs / 1000) : null;
  return (
    <div className="thread-run">
      <div className="thread-run-head">
        <span className={'act-glyph' + (run.state === 'running' ? ' running' : run.state === 'completed' ? ' ok' : run.state === 'failed' ? ' err' : '')}>{run.state === 'running' ? '' : run.state === 'completed' ? '✓' : run.state === 'failed' ? '✕' : '?'}</span>
        <span className="mono">{seatId || 'seat'}</span><span>run {runLabel(run.state)}</span>
        {seconds != null && <span className="act-time">{seconds}s</span>}
        <span className="act-time" style={{ marginLeft: 'auto' }}>{messageTime(entry.at)}</span>
      </div>
      {live ? (live.length ? <ActivityList items={live} /> : <div className="act-hint">Waiting for the seat's first step…</div>) : run.activity?.length ? <ActivityBlock items={run.activity} /> : null}
      {run.reply && <div className="thread-run-reply">{run.reply.length > 400 ? run.reply.slice(0, 400) + '…' : run.reply}</div>}
    </div>
  );
}

function PeerEntry({ entry, ceoName }: { entry: Extract<TimelineEntry, { kind: 'peer' }>; ceoName: string }) {
  const { message } = entry;
  const delivery = deliveryLabel(message);
  return (
    <div className="thread-peer">
      <div className="thread-run-head">
        <span className="mono">{addressLabel(message.from, ceoName)} → {addressLabel(message.to, ceoName)}</span>
        {message.replyTo && <span>reply</span>}
        <span className={'delivery-pill ' + delivery.tone}>{delivery.label}</span>
        <span className="act-time" style={{ marginLeft: 'auto' }}>{messageTime(message.createdAt)}</span>
      </div>
      <div className="thread-peer-text">{message.text}</div>
      {message.wake?.reply && (
        <div className="thread-peer-reply">
          <span className="mono">{addressLabel(message.to, ceoName)}</span>
          <div className="thread-peer-text">{message.wake.reply}</div>
        </div>
      )}
    </div>
  );
}

function useTaskThreadExtras(threadId: string, refreshKey: unknown) {
  const [extras, setExtras] = useState<TaskThreadExtras | null>(null);
  useEffect(() => {
    const general = threadId === 'general';
    if (!general && !threadId.startsWith('task_')) { setExtras(null); return; }
    let active = true;
    const load = async () => {
      try {
        if (general) {
          const { messages } = await api.messageDeliveries();
          if (active) setExtras({ seatId: null, runs: [], live: null, messages: generalThreadMessages(messages) });
          return;
        }
        const [task, messages] = await Promise.all([api.task(threadId), api.taskMessages(threadId)]);
        if (active) setExtras({ seatId: task.seatId, runs: task.runs || [], live: task.liveActivity || null, messages: messages.messages });
      } catch {   }
    };
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [threadId, refreshKey]);
  return extras;
}

function CeoChat() {
  const { state, loadCeoConversation, sendCeoMessage, setCeoThread } = useStore();
  const [draft, setDraft] = useState('');
  const [threads, setThreads] = useState<CeoThread[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const ceo = state.ceo;
  const ceoName = ceoNameOf(state.org.organization);
  const seatThread = parseSeatThread(state.ceoThread);
  const agentName = seatThread ? seatThread.seatId : ceoName;
  const working = ceo.sending || Boolean(ceo.live);
  const elapsed = useElapsed(working ? ceo.live?.startedAt || null : null);

  useEffect(() => {
    if (loadedRef.current || ceo.messages.length || ceo.sending || ceo.pendingMessage || ceo.failedMessage) return;
    loadedRef.current = true;
    void loadCeoConversation();
  }, [loadCeoConversation, ceo.messages.length, ceo.sending, ceo.pendingMessage, ceo.failedMessage]);

  useEffect(() => {
    let active = true;
    const thread = state.ceoThread;
    void (async () => {
      const [{ threads: list }, chart] = await Promise.all([api.ceoThreads(), api.orgChart().catch(() => ({ pods: [] }))]);
      for (const pod of chart.pods) for (const seat of pod.seats) list.push({ threadId: `seat:${pod.podId}/${seat.seatId}`, title: `${pod.name} / ${seat.seatId}`, ref: null, status: null, messageCount: 0, updatedAt: null, lastText: seat.role });
      if (thread.startsWith('task_') && !list.some(t => t.threadId === thread)) {
        const task = await api.task(thread).catch(() => null);
        if (task) list.push({ threadId: thread, title: task.summary, ref: task.ref, status: task.status, messageCount: 0, updatedAt: null, lastText: '' });
      }
      if (active) setThreads(list);
    })().catch(() => undefined);
    return () => { active = false; };
  }, [state.ceoThread, ceo.sending]);

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

  const send = () => {
    const text = draft.trim();
    if (!text || working) return;
    setDraft('');
    void sendCeoMessage(text);
  };
  const refreshConversation = () => { if (!ceo.loading) void loadCeoConversation(); };
  const hasVisibleMessages = ceo.messages.length > 0 || ceo.pendingMessage || ceo.failedMessage;
  const otherBusy = !working && ceo.busyThreadId && ceo.busyThreadId !== state.ceoThread;
  const currentThread = threads.find(t => t.threadId === state.ceoThread);
  const extras = useTaskThreadExtras(state.ceoThread, ceo.messages.length);
  const timeline = buildTimeline(ceo.messages, extras);

  return (
    <>
      <ThreadBar threads={threads} current={state.ceoThread} busy={working ? state.ceoThread : ceo.busyThreadId} disabled={ceo.sending} onPick={id => setCeoThread(id)} />
      <div ref={scrollRef} className="pane-body" style={{ padding: '20px 18px', gap: 16 }} aria-live="polite">
        {ceo.loading && !ceo.messages.length && <div className="empty">Loading conversation…</div>}
        {ceo.loadError && (
          <div className="empty" role="alert">
            <div>{ceo.loadError}</div>
            <button className="btn sm btn-ghost" style={{ marginTop: 10 }} onClick={loadCeoConversation}>Retry</button>
          </div>
        )}
        {!ceo.loading && !ceo.loadError && !hasVisibleMessages && !timeline.length && (
          <div className="empty">No messages yet.</div>
        )}
        {timeline.map((entry, i) => {
          if (entry.kind === 'run') return <RunEntry key={`run-${entry.run.id}`} entry={entry} seatId={extras?.seatId || null} />;
          if (entry.kind === 'peer') return <PeerEntry key={`peer-${entry.message.id}`} entry={entry} ceoName={ceoName} />;
          const m = entry.message;
          if (m.role === 'activity') return <ActivityBlock key={`${m.at}-${i}`} items={m.items || []} />;
          if (m.role === 'user') return <UserBubble key={`${m.at}-${i}`} text={m.text || ''} meta={messageTime(m.at)} />;
          return <CeoBubble key={`${m.at}-${i}`} text={m.text || ''} at={m.at} name={m.role === 'seat' ? agentName : 'ceo'} />;
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
            <span className="ellipsis">Thread: <span style={{ color: 'var(--muted)' }}>{threadName(currentThread, state.ceoThread)}</span></span>
            <button className="btn btn-primary" style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 6, fontSize: 12, opacity: draft.trim() && !working ? 1 : 0.45 }} disabled={!draft.trim() || working} onClick={send}>{working ? 'Working…' : 'Send'}</button>
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
  const tabs: [PaneTab, string][] = [['ceo', ceoNameOf(state.org.organization)], ['tasks', 'Tasks'], ['artifacts', 'Artifacts'], ['inbox', 'Inbox']];
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
