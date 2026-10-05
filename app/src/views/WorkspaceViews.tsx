import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { byParent, inboxParent } from '../model';
import { useStore } from '../store';
import { GroupHead, OnDot, WorkspaceHead, useInboxItem } from '../components/ui';

/* ── Inbox ─────────────────────────────────────────── */

function InboxRow({ it }: { it: D.InboxItem }) {
  const a = useInboxItem(it);
  const nav = useNavigate();
  return (
    <div className="row" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '18px 20px', opacity: a.pending ? 1 : 0.55 }}>
      <OnDot on={a.pending} size={8} style={{ marginTop: 7 }} />
      <div className="stack" style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 11.5, color: 'var(--dim)' }}>
          <span style={{ font: '500 10.5px var(--mono)', letterSpacing: '.06em' }}>{it.kind.toUpperCase()}</span>
          <span>from <span className="mono">{it.from}</span></span>
          <span style={{ marginLeft: 'auto' }}>{it.when}</span>
        </div>
        <div style={{ fontSize: 14 }}>{it.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{it.detail}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          {a.pending ? (
            <>
              <button className="btn btn-primary" onClick={a.approve}>{it.cta}</button>
              <button className="btn btn-ghost" onClick={a.decline}>{a.declineLabel}</button>
            </>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--text-4)' }}>{a.doneLabel}</span>
          )}
          {it.task && <span className="crumb-link" style={{ marginLeft: 'auto', fontSize: 12.5 }} onClick={() => nav('/tasks/' + it.task)}>{it.task} →</span>}
        </div>
      </div>
    </div>
  );
}

export function InboxView() {
  const groups = byParent(D.inbox, inboxParent);
  return (
    <div className="page" style={{ maxWidth: 820, gap: 24 }}>
      <div className="page-head">
        <div className="eyebrow">INBOX</div>
        <h1 className="h1">Waiting on you</h1>
      </div>
      {groups.map(g => (
        <div key={g.key} className="stack" style={{ gap: 10 }}>
          <GroupHead g={g} />
          <div className="list">{g.items.map(it => <InboxRow key={it.id} it={it} />)}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Routines ──────────────────────────────────────── */

export function RoutinesView() {
  const { state, set } = useStore();
  return (
    <div className="page" style={{ maxWidth: 920, gap: 24 }}>
      <WorkspaceHead title="Routines" lede="Recurring work seats pick up on a schedule. Each run is recorded with the same evidence as any task." ledeWidth={600} />
      <div className="list">
        {D.routines.map(r => {
          const off = !!state.routinesOff[r.id];
          return (
            <div key={r.id} className="row" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '16px 18px', opacity: off ? 0.55 : 1 }}>
              <div className="stack" style={{ flex: '1 1 260px', minWidth: 0, gap: 3 }}>
                <div style={{ fontSize: 13.5 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: 'var(--dim)' }}><span className="mono" style={{ color: 'var(--text-4)' }}>{r.seat}</span> · {r.scope} · {r.schedule}</div>
              </div>
              <div className="stack" style={{ gap: 2, fontSize: 12, color: 'var(--dim)', minWidth: 150 }}>
                <span>Last · <span style={{ color: r.lastState === 'warn' ? 'var(--text)' : 'var(--text-4)' }}>{r.last}</span></span>
                <span>Next · <span style={{ color: 'var(--text-4)' }}>{off ? 'Paused' : r.next}</span></span>
              </div>
              <button
                className={'switch' + (off ? ' off' : '')}
                role="switch"
                aria-checked={!off}
                title="Enable / pause"
                onClick={() => set(s => ({ routinesOff: { ...s.routinesOff, [r.id]: !s.routinesOff[r.id] } }))}
              ><div /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Artifacts ─────────────────────────────────────── */

const ART_FILTERS: ('all' | D.ProjectId)[] = ['all', 'web', 'api', 'cmp'];

export function ArtifactsView() {
  const [filter, setFilter] = useState<'all' | D.ProjectId>('all');
  const nav = useNavigate();
  const groups = byParent(D.allArtifacts.filter(a => filter === 'all' || a.p === filter), a => a.p);
  const projName = (id: D.ProjectId) => D.projects.find(p => p.id === id)!.name;

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 24 }}>
      <WorkspaceHead title="Artifacts" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ART_FILTERS.map(k => (
          <button key={k} className={'filter' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : projName(k)}</button>
        ))}
      </div>
      {groups.map(g => (
        <div key={g.key} className="stack" style={{ gap: 10 }}>
          <GroupHead g={g} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
            {g.items.map(a => (
              <div key={a.name} className="card link stack" style={{ borderRadius: 11, overflow: 'hidden' }} onClick={() => nav(a.to)}>
                <div className="hatch" style={{ height: 120, borderBottom: '1px solid var(--border)', padding: '0 12px', textAlign: 'center' }}>{a.kind}</div>
                <div className="stack" style={{ padding: '11px 13px', gap: 3 }}>
                  <div className="ellipsis" style={{ font: '400 12.5px var(--mono)', color: 'var(--text)' }}>{a.name}</div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--faint)' }}>
                    <span className="mono">{projName(a.p)}</span><span style={{ marginLeft: 'auto' }}>{a.src}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Skills ────────────────────────────────────────── */

export function SkillsView() {
  return (
    <div className="page" style={{ maxWidth: 960, gap: 24 }}>
      <WorkspaceHead title="Skills" lede="Hermes skills available to seats, by where they live. Promoted lessons land here as versioned changes." />
      {D.skillGroups.map(g => (
        <div key={g.label} className="stack" style={{ gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div className="section-title">{g.label}</div>
            <span style={{ fontSize: 12, color: 'var(--faint)' }}>{g.sub}</span>
          </div>
          <div className="list">
            {g.items.map(s => (
              <div key={s.name} className="row" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 16px' }}>
                <div className="stack" style={{ flex: '1 1 260px', minWidth: 0, gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ font: '500 12.5px var(--mono)' }}>{s.name}</span>
                    <span style={{ font: '400 11px var(--mono)', color: 'var(--fainter)' }}>{s.ver}</span>
                    {s.proposed && (
                      <span style={{ font: '500 10.5px var(--mono)', letterSpacing: '.04em', padding: '1px 6px', borderRadius: 5, border: '1px solid oklch(0.72 0.14 252 / .4)', color: 'var(--acc-text)' }}>PROPOSED</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{s.desc}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--dim)', textAlign: 'right' }}>{s.used}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Connectors ────────────────────────────────────── */

export function ConnectorsView() {
  const { state, set } = useStore();
  return (
    <div className="page" style={{ maxWidth: 960, gap: 24 }}>
      <WorkspaceHead title="Connectors" lede="What the control plane can reach on this machine, and which seats can use it." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
        {D.connectors.map(c => {
          const on = state.connected[c.id] ?? c.on;
          return (
            <div key={c.id} className="card stack" style={{ padding: 16, gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border-3)', background: 'var(--hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '500 11px var(--mono)', color: 'var(--text-4)' }}>{c.id.toUpperCase()}</div>
                <div className="stack"><span style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name}</span><span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{c.kind}</span></div>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: on ? 'var(--text-3)' : 'var(--faint)' }}>
                  <OnDot on={on} />{on ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', textWrap: 'pretty' }}>{c.detail}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid var(--row-line)' }}>
                <span className="ellipsis" style={{ font: '400 11.5px var(--mono)', color: 'var(--faint)' }}>{on && c.scope === 'not connected' ? 'connected just now' : c.scope}</span>
                <button
                  className={'btn ' + (on ? 'btn-ghost' : 'btn-primary')}
                  style={{ marginLeft: 'auto', padding: '5px 11px', fontSize: 12, whiteSpace: 'nowrap', fontWeight: 400, ...(on ? {} : { border: '1px solid transparent' }) }}
                  onClick={() => { if (!on) set(s => ({ connected: { ...s.connected, [c.id]: true } })); }}
                >{on ? 'Manage' : 'Connect'}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
