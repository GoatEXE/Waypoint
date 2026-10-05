import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { ACC, missionPct, projStats, seatStatus } from '../model';
import { activeProject, useRoute, type View } from '../routes';
import { useStore } from '../store';
import { Dot, OnDot } from './ui';

// [view, label, icon width, icon height, icon radius, icon rotation]
const WORKSPACE: [View, string, number, number, string, number][] = [
  ['inbox', 'Inbox', 12, 9, '2px', 0],
  ['routines', 'Routines', 11, 11, '50%', 0],
  ['artifacts', 'Artifacts', 10, 10, '2px', 0],
  ['skills', 'Skills', 8, 8, '1px', 45],
  ['connectors', 'Connectors', 12, 7, '4px', 0],
];

function AddButton({ onClick }: { onClick: () => void }) {
  return <button className="sb-add" title="New" onClick={onClick}>+</button>;
}

export function Sidebar() {
  const { state, set, setPane, openModal, tasks, pending } = useStore();
  const nav = useNavigate();
  const route = useRoute();
  const activeProj = activeProject(route);
  const activePod = route.v === 'pod' || route.v === 'review' ? route.id : null;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">Waypoint</div>
        <div className="brand-env">LOCAL</div>
      </div>
      <div className="new-assign-wrap">
        <button className="new-assign" onClick={() => openModal('assignment')}>
          <span className="plus">+</span>New assignment
          <span className="tag">CEO</span>
        </button>
      </div>

      <div className="sb-scroll">
        <div className="sb-section">
          <div className="sb-label sb-label-pad">WORKSPACE</div>
          {WORKSPACE.map(([v, label, iw, ih, ir, rot]) => (
            <div key={v} className={'sb-item' + (route.v === v ? ' active' : '')} onClick={() => nav('/' + v)}>
              <div className="sb-icon"><div style={{ width: iw, height: ih, borderRadius: ir, transform: `rotate(${rot}deg)` }} /></div>
              <span>{label}</span>
              {v === 'inbox' && pending.length > 0 && <span className="sb-count">{pending.length}</span>}
            </div>
          ))}
        </div>

        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">MISSION</span><AddButton onClick={() => openModal('mission')} /></div>
          <div className={'sb-mission' + (route.v === 'mission' ? ' active' : '')}>
            <button className="sb-caret" title="Show projects" onClick={() => set(s => ({ missionOpen: !s.missionOpen }))}>
              <span style={{ transform: `rotate(${state.missionOpen ? 90 : 0}deg)` }}>▸</span>
            </button>
            <div className="sb-mission-link" onClick={() => nav('/')}>
              <div className="diamond" />
              <span className="ellipsis" style={{ fontWeight: 500 }}>{D.mission.short}</span>
              <span className="sb-meta">{missionPct(tasks)}%</span>
            </div>
          </div>
          {state.missionOpen && (
            <div className="sb-children">
              {D.projects.map(p => (
                <div key={p.id} className={'sb-item' + (activeProj === p.id ? ' active' : '')} onClick={() => nav('/projects/' + p.id)}>
                  <span className="sb-name">{p.name}</span>
                  <span className="sb-meta">{projStats(p, tasks).pct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">PODS</span><AddButton onClick={() => openModal('pod')} /></div>
          {D.pods.map(p => {
            const stopped = state.podStopped && p.name === 'web-squad-01';
            return (
              <div key={p.name} className={'sb-item' + (activePod === p.name ? ' active' : '')} style={{ color: 'var(--text)' }} onClick={() => nav('/pods/' + p.name)}>
                <OnDot on={!stopped} />
                <span className="sb-name">{p.name}</span>
                <span className="sb-meta">{D.seats.filter(s => s.pod === p.name).length}</span>
              </div>
            );
          })}
        </div>

        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">SEATS</span><AddButton onClick={() => openModal('seat')} /></div>
          {D.seats.map(s => (
            <div
              key={s.name}
              className={'sb-item seat' + (route.v === 'pod' && state.seat === s.name ? ' active' : '')}
              onClick={() => {
                if (s.pod) { set({ seat: s.name }); nav('/pods/' + s.pod); }
                else setPane({ open: true, tab: 'ceo' });
              }}
            >
              <Dot status={seatStatus(s, state.resolved, state.podStopped)} size={7} />
              <span className="sb-name c-text3">{s.name}</span>
              <span className="sb-role">{s.role}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-footer">
        <div><div style={{ width: 6, height: 6, borderRadius: '50%', background: ACC }} />Host service connected</div>
        <div><div style={{ width: 6, height: 6, borderRadius: '50%', border: '1.5px solid var(--fainter)' }} />Bitwarden · 3 machine accounts</div>
      </div>
    </aside>
  );
}
