import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { projById, st } from '../model';
import { api, type CeoThread } from '../api';
import { needsYou, taskLabel } from '../taskQueueModel';
import { ActivityBlock, ActivityList } from './Activity';
import { TaskRefText } from './TaskRefText';
import { useStore, useViewport, type PaneTab } from '../store';
import { ceoNameOf } from '../orgModel';
import { deleteThreadCopy, isTaskThread, talkedTaskThreads, threadMeta, visibleTaskThreads } from '../ceoThreads';
import { errorText } from '../runtimeHealth';
import { ConfirmPanel } from './ConfirmPanel';
import { Dot } from './ui';
import { PANE_DOCK_MIN } from './layout';
import { useRuntimeHealth } from './RuntimeBanner';
import { TaskThread, useTaskActions, useTaskDetail } from './TaskThread';

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
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => api.ceoThreads().then(result => { if (active) setData(result); }).catch(() => undefined);
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshKey, version]);
  return { ...data, reload: () => setVersion(v => v + 1) };
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

function PaneTaskConversation({ id }: { id: string }) {
  const { load, setLoad, activity } = useTaskDetail(id);
  const actions = useTaskActions(load.status === 'ready' ? load.task : null, setLoad);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const task = load.status === 'ready' ? load.task : null;
  const size = task ? `${task.id}:${task.comments.length}:${task.events.length}:${task.runs?.length || 0}:${task.status}:${activity?.items.length || 0}` : '';
  useEffect(() => { pinnedRef.current = true; }, [id]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [size]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  return (
    <div ref={scrollRef} className="pane-body pane-task-thread" onScroll={onScroll} aria-live="polite">
      {load.status === 'loading' && <div className="empty" role="status">Loading conversation…</div>}
      {load.status === 'notfound' && <div className="empty">This task is no longer available.</div>}
      {load.status === 'error' && <div className="empty" role="alert">{load.error}</div>}
      {task && <TaskThread task={task} activity={activity} actions={actions} compact />}
    </div>
  );
}

function TasksTab() {
  const { state, setCeoThread, setPane } = useStore();
  const nav = useNavigate();
  const { threads, busyThreadId } = useCeoThreads(state.ceo.sending);
  const current = state.ceoThread;
  if (!isTaskThread(current)) return <TaskThreadList threads={threads} busy={busyThreadId} onPick={id => { setPane({ taskView: 'thread' }); setCeoThread(id); }} />;
  const thread = threads.find(t => t.threadId === current);
  const view = state.pane.taskView;
  const ceoName = ceoNameOf(state.org.organization);
  return (
    <>
      <div className="thread-head">
        <button type="button" className="thread-back" onClick={() => setCeoThread('general')}>← Tasks</button>
        <span className="thread-head-title ellipsis">{threadName(thread, current)}</span>
        <button type="button" className="icon-btn" title="Open task" onClick={() => nav('/tasks/' + encodeURIComponent(thread?.ref || current))}>↗</button>
      </div>
      <div className="pane-seg" role="tablist" aria-label="Task view">
        <button type="button" role="tab" aria-selected={view === 'thread'} className={'pane-seg-btn' + (view === 'thread' ? ' on' : '')} onClick={() => setPane({ taskView: 'thread' })}>Conversation</button>
        <button type="button" role="tab" aria-selected={view === 'ceo'} className={'pane-seg-btn' + (view === 'ceo' ? ' on' : '')} onClick={() => setPane({ taskView: 'ceo' })}>Ask {ceoName}</button>
      </div>
      {view === 'thread' ? <PaneTaskConversation key={current} id={current} /> : <CeoChat />}
    </>
  );
}

function ThreadMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="thread-menu" ref={ref}>
      <button type="button" className={'icon-btn thread-menu-btn' + (open ? ' on' : '')} title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>⋯</button>
      {open && <div className="thread-menu-pop" role="menu" onClick={e => e.stopPropagation()}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function useDeleteThread(onDeleted: (id: string) => void) {
  const { state, setCeoThread, flash } = useStore();
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ask = (id: string) => { setTarget(id); setError(''); };
  const cancel = () => { setTarget(null); setError(''); };
  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteCeoThread(target);
      if (state.ceoThread === target) setCeoThread('general');
      setTarget(null);
      flash('Thread deleted');
      onDeleted(target);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return { target, busy, error, ask, cancel, confirm };
}

function CeoThreadList() {
  const { state, setCeoThread, setPane } = useStore();
  const { threads, busyThreadId, reload } = useCeoThreads(state.ceo.sending);
  const del = useDeleteThread(() => reload());
  const ceoName = ceoNameOf(state.org.organization);
  const general = threads.find(t => t.threadId === 'general');
  const talked = talkedTaskThreads(threads);
  const current = state.ceoThread;
  const open = (id: string) => { setCeoThread(id); setPane({ ceoList: false }); };
  const row = (t: CeoThread | undefined, id: string, pinned = false) => (
    <div key={id} className={'thread-item' + (current === id ? ' on' : '')}>
      <button type="button" className="thread-row" aria-current={current === id ? 'true' : undefined} onClick={() => open(id)}>
        <span className="thread-row-title">
          {busyThreadId === id && <span className="thread-row-busy" title="Working" />}
          <span className="ellipsis">{threadName(t, id)}</span>
          {pinned && <span className="thread-pin" title="Pinned">Pinned</span>}
        </span>
        <span className="thread-row-meta ellipsis">{t ? (t.lastText || threadMeta(t)) : 'Loading…'}</span>
      </button>
      {!pinned && (
        <ThreadMenu label="Thread actions">
          {close => (
            <button type="button" role="menuitem" className="user-menu-item danger" disabled={busyThreadId === id} title={busyThreadId === id ? `${ceoName} is working in this thread` : undefined} onClick={() => { close(); del.ask(id); }}>Delete thread</button>
          )}
        </ThreadMenu>
      )}
      {del.target === id && <div className="thread-confirm"><ConfirmPanel copy={deleteThreadCopy(threadName(t, id), ceoName)} busy={del.busy} error={del.error} onCancel={del.cancel} onConfirm={() => void del.confirm()} /></div>}
    </div>
  );
  return (
    <div className="pane-body thread-list">
      {row(general, 'general', true)}
      {talked.length > 0 && <div className="thread-group">Task threads</div>}
      {talked.map(t => row(t, t.threadId))}
      {!talked.length && <div className="thread-hint">Task threads show up here once you talk to {ceoName} about a task. Open a task and choose Ask {ceoName} to start one.</div>}
    </div>
  );
}

function CeoThreadHead() {
  const { state, setPane } = useStore();
  const nav = useNavigate();
  const { threads, busyThreadId } = useCeoThreads(state.ceo.sending);
  const current = state.ceoThread;
  const toList = () => setPane({ ceoList: true });
  const del = useDeleteThread(() => toList());
  const ceoName = ceoNameOf(state.org.organization);
  const thread = threads.find(t => t.threadId === current);
  const task = isTaskThread(current);
  return (
    <>
      <div className="thread-head">
        <button type="button" className="thread-back" title="All threads" aria-label="All threads" onClick={toList}>←</button>
        <span className="thread-head-title ellipsis">{threadName(thread, current)}</span>
        {task && (
          <ThreadMenu label="Thread actions">
            {close => (
              <>
                <button type="button" role="menuitem" className="user-menu-item" onClick={() => { close(); nav('/tasks/' + encodeURIComponent(thread?.ref || current)); }}>Open task</button>
                <button type="button" role="menuitem" className="user-menu-item danger" disabled={busyThreadId === current} title={busyThreadId === current ? `${ceoName} is working in this thread` : undefined} onClick={() => { close(); del.ask(current); }}>Delete thread</button>
              </>
            )}
          </ThreadMenu>
        )}
      </div>
      {del.target === current && <div className="thread-confirm head"><ConfirmPanel copy={deleteThreadCopy(threadName(thread, current), ceoName)} busy={del.busy} error={del.error} onCancel={del.cancel} onConfirm={() => void del.confirm()} /></div>}
    </>
  );
}

function CeoTab() {
  const { state } = useStore();
  if (state.pane.ceoList) return <CeoThreadList />;
  return <><CeoThreadHead /><CeoChat /></>;
}

function CeoChat() {
  const { state, loadCeoConversation, sendCeoMessage } = useStore();
  const nav = useNavigate();
  const health = useRuntimeHealth();
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
              {ceo.sendError && !health.ready && <button className="btn sm btn-primary" onClick={() => nav(health.cause === 'setup' ? '/connectors' : '/settings')}>{health.cause === 'setup' ? 'Open Connectors' : 'Open Settings'}</button>}
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
            <button className="btn btn-primary" style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 6, fontSize: 12}} disabled={!draft.trim() || blocked} onClick={send}>{working ? 'Working…' : 'Send'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function InboxTab() {
  const { state } = useStore();
  const nav = useNavigate();
  const tasks = needsYou(state.board);
  return (
    <div className="pane-body thread-list">
      {!tasks.length && <div className="empty">You're all caught up.</div>}
      {tasks.map(t => (
        <button key={t.id} type="button" className="thread-row" onClick={() => nav('/tasks/' + encodeURIComponent(taskLabel(t)))}>
          <span className="thread-row-title"><span className="ellipsis">{taskLabel(t)} · {t.title}</span></span>
          <span className="thread-row-meta ellipsis">{t.status === 'review' ? 'In review' : 'Blocked'}{t.assignee ? ` · ${t.assignee}` : ''}</span>
        </button>
      ))}
      <button type="button" className="thread-more" onClick={() => nav('/inbox')}>Open inbox →</button>
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
  const pick = (k: PaneTab) => {
    if (k === tab) return;
    if (k === 'ceo') { setCeoThread('general'); setPane({ tab: k, ceoList: false }); }
    else if (k === 'tasks' && tab === 'ceo' && isTaskThread(state.ceoThread)) setPane({ tab: k, taskView: 'ceo' });
    else setPane({ tab: k });
  };
  const waiting = needsYou(state.board).length;
  const tabs: [PaneTab, string][] = [['ceo', ceoNameOf(state.org.organization)], ['tasks', 'Tasks'], ['inbox', waiting ? `Inbox · ${waiting}` : 'Inbox']];
  if (item) tabs.push(['item', item]);

  return (
    <aside className={'pane' + (vw < PANE_DOCK_MIN ? ' overlay' : '')}>
      <div className="pane-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={'pane-tab' + (tab === k ? ' on' : '') + (k === 'item' ? ' mono' : '')} onClick={() => pick(k)}>{label}</button>
        ))}
        <button className="icon-btn" style={{ marginLeft: 'auto' }} title="Close" onClick={() => setPane({ open: false })}>×</button>
      </div>
      {tab === 'ceo' && <CeoTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'inbox' && <InboxTab />}
      {tab === 'item' && item && <PinnedTask id={item} />}
    </aside>
  );
}
