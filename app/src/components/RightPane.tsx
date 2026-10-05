import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { byParent, clock, inboxParent, projById, st } from '../model';
import { chatContextFor, useRoute } from '../routes';
import { useStore, useViewport, type PaneTab } from '../store';
import { ApprovalCard, Dot, PaneGroupHead, useInboxItem } from './ui';
import { PANE_DOCK_MIN } from './layout';

function CeoChat() {
  const { state, askCeo } = useStore();
  const ctx = chatContextFor(useRoute());
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = [...D.chat, ...state.chatExtra];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, state.typing]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    askCeo(text, () => [
      { tool: `tasks.draft context=${ctx}` },
      { who: 'ceo', time: clock(), text: `Got it. I'll scope this against ${ctx === 'mission' ? 'the mission' : ctx} and route it to the right seat. A draft task will appear under the relevant project; anything that needs a new seat or a secret will come to you first.` },
    ]);
  };

  return (
    <>
      <div ref={scrollRef} className="pane-body" style={{ padding: '20px 18px', gap: 16 }}>
        {entries.map((m, i) => {
          if ('card' in m) return <ApprovalCard key={i} it={D.inbox.find(x => x.id === m.card)!} gap={8} />;
          if ('tool' in m) return <div key={i} className="tool-line">⌁ {m.tool}</div>;
          if (m.who === 'you') return (
            <div key={i} className="stack" style={{ alignSelf: 'flex-end', maxWidth: '86%', alignItems: 'flex-end', gap: 4 }}>
              <div className="bubble-you">{m.text}</div>
              <span style={{ fontSize: 11, color: 'var(--fainter)' }}>{m.time}</span>
            </div>
          );
          return (
            <div key={i} className="stack" style={{ gap: 6, maxWidth: '94%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--dim)' }}>
                <div className="ceo-mark" /><span className="mono c-text3">ceo</span><span>{m.time}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)', textWrap: 'pretty' }}>{m.text}</div>
            </div>
          );
        })}
        {state.typing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--faint)' }}>
            <div className="ceo-mark" style={{ animation: 'wp-pulse 1s infinite' }} />ceo is planning…
          </div>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
        <div className="composer">
          <textarea
            rows={2}
            value={draft}
            placeholder="Give the CEO an assignment, or ask about progress…"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fainter)' }}>
            <span>Context: <span className="mono" style={{ color: 'var(--muted)' }}>{ctx}</span></span>
            <button className="btn btn-primary" style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 6, fontSize: 12 }} onClick={send}>Send</button>
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

function PaneInboxCard({ it }: { it: D.InboxItem }) {
  const a = useInboxItem(it);
  return (
    <div className="pane-card stack" style={{ padding: '13px 14px', gap: 6, opacity: a.pending ? 1 : 0.55 }}>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--dim)' }}>
        <span style={{ font: '500 10.5px var(--mono)', letterSpacing: '.06em' }}>{it.kind.toUpperCase()}</span>
        <span style={{ marginLeft: 'auto' }}>{it.when}</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.4 }}>{it.title}</div>
      {a.pending ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button className="btn sm btn-primary" onClick={a.approve}>{it.cta}</button>
          <button className="btn sm btn-ghost" onClick={a.decline}>{a.declineLabel}</button>
        </div>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{a.doneLabel}</span>
      )}
    </div>
  );
}

function InboxTab() {
  return (
    <div className="pane-body" style={{ padding: 14, gap: 10 }}>
      {byParent(D.inbox, inboxParent).map(g => (
        <div key={g.key} className="stack" style={{ gap: 8, marginBottom: 8 }}>
          <div style={{ padding: '2px 2px 0' }}><PaneGroupHead g={g} /></div>
          {g.items.map(it => <PaneInboxCard key={it.id} it={it} />)}
        </div>
      ))}
    </div>
  );
}

function PinnedTask({ id }: { id: string }) {
  const { tasks } = useStore();
  const nav = useNavigate();
  const t = tasks.find(x => x.id === id)!;
  const s = st(t.st);
  const blockedBy = t.st === 'blocked' || t.st === 'decision' ? t.blockedBy : undefined;
  return (
    <div className="pane-body" style={{ padding: '22px 20px', gap: 18 }}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow" style={{ letterSpacing: '.06em' }}>{t.id} · {projById(t.p).name}</div>
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
            const r = D.runs[rid]; const rs = st(r.st);
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
  const { state, pending, setPane } = useStore();
  const vw = useViewport();
  const { tab, item } = state.pane;
  const tabs: [PaneTab, string][] = [['ceo', 'CEO'], ['tasks', 'Tasks'], ['artifacts', 'Artifacts'], ['inbox', 'Inbox' + (pending.length ? ' ' + pending.length : '')]];
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
