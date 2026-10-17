import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ACC } from '../model';
import { activeProject, useRoute, type View } from '../routes';
import { useStore } from '../store';
import { NavIcon, type NavIconName } from './NavIcon';
import { api, pendingLearning, type OrgSeat } from '../api';
import { needsYou } from '../taskQueueModel';
import { SeatMark } from './ProviderMark';
import { DRY_RUN_REASON } from '../dryRun';
import { runtimeHealth } from '../runtimeHealth';
import { seatWork } from '../seatModel';
import { missionPath, routeMission, SIDEBAR_MISSION_LIMIT, sidebarMissionLabel, visibleMissions } from '../missionsModel';
import type { Mission, Project } from '../api';
import { ceoNameOf } from '../orgModel';
import { UserMenu } from './UserMenu';

const SOON = new Set<View>(['routines', 'artifacts']);

const WORKSPACE: [View & NavIconName, string][] = [
  ['tasks', 'Tasks'],
  ['org', 'Organization'],
  ['inbox', 'Inbox'],
  ['routines', 'Routines'],
  ['artifacts', 'Artifacts'],
  ['skills', 'Skills'],
  ['connectors', 'Connectors'],
];

function AddButton({ onClick, disabledReason }: { onClick: () => void; disabledReason?: string }) {
  return <button className="sb-add" title={disabledReason || 'New'} disabled={Boolean(disabledReason)} onClick={onClick}>+</button>;
}

export function Sidebar() {
  const { state, set, openModal, loadBoard } = useStore();
  const nav = useNavigate();
  const dryRun = state.config?.dryRun ? DRY_RUN_REASON : undefined;
  const route = useRoute();
  const activeProj = activeProject(route);
  const [seats, setSeats] = useState<OrgSeat[]>([]);
  const shownPods = state.pods.filter(pod => pod.status === 'active' || pendingLearning(pod) > 0);
  const attention = needsYou(state.board).length + state.pods.filter(pod => pendingLearning(pod) > 0).length;
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [orgSeats] = await Promise.all([api.orgSeats().catch(() => ({ seats: [] as OrgSeat[] })), loadBoard()]);
        if (!active) return;
        setSeats(orgSeats.seats);
      } catch {   }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [state.missions.missions, loadBoard]);
  const { label: hermesLabel, ready: hermesReady } = runtimeHealth(state.runtime.status, state.runtime.error, state.runtime.checked);
  const missionLabel = sidebarMissionLabel(state.missions);
  const missions = state.missions.status === 'ready' ? state.missions.missions : [];
  const activeMissionId = routeMission(state.missions, route, state.projects, state.board)?.id ?? null;
  const { shown: shownMissions, hidden: hiddenMissions } = visibleMissions(missions, state.missionsExpanded, activeMissionId);
  const unfiledProjects = state.projects.filter(p => !p.missionId || !state.missions.missions.some(m => m.id === p.missionId));
  const isOpen = (key: string, fallback: boolean) => state.missionOpen[key] ?? fallback;
  const toggle = (key: string, fallback: boolean) => set(s => ({ missionOpen: { ...s.missionOpen, [key]: !(s.missionOpen[key] ?? fallback) } }));
  const projectRows = (projects: Project[]) => projects.map(p => (
    <div key={p.id} className={'sb-item' + (activeProj === p.id ? ' active' : '')} onClick={() => nav('/projects/' + p.id)}>
      <span className="sb-name">{p.name}</span>
    </div>
  ));
  const missionRow = (m: Mission) => {
    const projects = state.projects.filter(p => p.missionId === m.id);
    const open = isOpen(m.id, m.id === activeMissionId);
    return (
      <div key={m.id} className="sb-mission-group">
        <div className={'sb-mission' + (route.v === 'mission' && m.id === activeMissionId ? ' active' : '')}>
          <button className="sb-caret" title={open ? 'Hide projects' : 'Show projects'} aria-expanded={open} onClick={() => toggle(m.id, m.id === activeMissionId)}>
            <span style={{ transform: `rotate(${open ? 90 : 0}deg)` }}>▸</span>
          </button>
          <div className="sb-mission-link" onClick={() => nav(missionPath(m.id))}>
            <div className="diamond" />
            <span className="ellipsis" style={{ fontWeight: 500 }} title={m.title}>{m.title}</span>
            {projects.length > 0 && <span className="sb-meta">{projects.length}</span>}
          </div>
        </div>
        {open && (
          <div className="sb-children">
            {projectRows(projects)}
            {!projects.length && <div className="sb-item sb-empty">No projects</div>}
          </div>
        )}
      </div>
    );
  };
  const unfiledOpen = isOpen('unfiled', false);

  return (
    <aside className="sidebar">
      <div className="brand">
        {state.org.organization?.logo ? <img className="brand-logo" src={state.org.organization.logo} alt="" /> : <div className="brand-mark" />}
        <div className="brand-name" title={state.org.organization?.name}>{state.org.organization?.name || 'Waypoint'}</div>
      </div>
      <div className="new-assign-wrap">
        <button className="new-assign" onClick={() => openModal('assignment')}>
          <span className="plus">+</span>Ask {ceoNameOf(state.org.organization)}
        </button>
      </div>

      <div className="sb-scroll">
        <div className="sb-section">
          <div className="sb-label sb-label-pad">WORKSPACE</div>
          {WORKSPACE.map(([v, label]) => (
            <div key={v} className={'sb-item' + (route.v === v ? ' active' : '') + (SOON.has(v) ? ' soon' : '')} title={SOON.has(v) ? 'Coming soon' : undefined} onClick={() => nav('/' + v)}>
              <div className="sb-icon"><NavIcon name={v} /></div>
              <span>{label}</span>
              {v === 'inbox' && attention > 0 && <span className="sb-count">{attention}</span>}
              {SOON.has(v) && <span className="soon-tag">Soon</span>}
            </div>
          ))}
        </div>

        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">{missions.length > 1 ? 'MISSIONS' : 'MISSION'}</span><AddButton onClick={() => openModal('mission')} /></div>
          {!missions.length && (
            <div className={'sb-mission' + (route.v === 'mission' ? ' active' : '')}>
              <div className="sb-mission-link" style={{ paddingLeft: 8 }} onClick={() => nav('/')}>
                <div className="diamond" />
                <span className="ellipsis" style={{ fontWeight: 500 }} title={missionLabel}>{missionLabel}</span>
              </div>
            </div>
          )}
          {shownMissions.map(missionRow)}
          {(hiddenMissions > 0 || state.missionsExpanded) && missions.length > SIDEBAR_MISSION_LIMIT && (
            <button className="sb-more" aria-expanded={state.missionsExpanded} onClick={() => set(s => ({ missionsExpanded: !s.missionsExpanded }))}>
              {state.missionsExpanded ? 'Show less' : `Show ${hiddenMissions} more`}
            </button>
          )}
          {unfiledProjects.length > 0 && (
            <div className="sb-mission-group">
              <div className="sb-mission">
                <button className="sb-caret" title={unfiledOpen ? 'Hide projects' : 'Show projects'} aria-expanded={unfiledOpen} onClick={() => toggle('unfiled', false)}>
                  <span style={{ transform: `rotate(${unfiledOpen ? 90 : 0}deg)` }}>▸</span>
                </button>
                <div className="sb-mission-link sb-unfiled" onClick={() => toggle('unfiled', false)}>
                  <span className="ellipsis">Not in a mission</span>
                  <span className="sb-meta">{unfiledProjects.length}</span>
                </div>
              </div>
              {unfiledOpen && <div className="sb-children">{projectRows(unfiledProjects)}</div>}
            </div>
          )}
        </div>

        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">PODS</span><AddButton onClick={() => openModal('pod')} disabledReason={dryRun} /></div>
          {!shownPods.length && <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default' }}>No pods</div>}
          {shownPods.map(pod => (
            <div key={pod.name} className={'sb-item' + (route.v === 'pod' && route.id === pod.name ? ' active' : '')} title={pod.purpose} onClick={() => nav('/pods/' + pod.name)}>
              <span className="sb-name mono">{pod.name}</span>
              <span className="sb-meta">{pod.status === 'active' ? pod.seats.length : 'review'}</span>
            </div>
          ))}
        </div>

        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">SEATS</span><AddButton onClick={() => openModal('seat')} disabledReason={dryRun} /></div>
          {!seats.length && <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default' }}>No seats</div>}
          {seats.map(seat => (
            <div key={seat.id} className={'sb-item' + (route.v === 'seat' && route.id === seat.id ? ' active' : '')} title={seat.description} onClick={() => nav('/seats/' + encodeURIComponent(seat.id))}>
              <SeatMark provider={seat.provider} />
              <span className="sb-name">{seat.id}</span>
              {seatWork(seat.id, state.board).state === 'running' && <span className="thread-row-busy" title="Working" style={{ marginLeft: 'auto' }} />}
            </div>
          ))}
        </div>
      </div>

      <div className="sb-footer">
        <div><div style={{ width: 6, height: 6, borderRadius: '50%', background: hermesReady ? ACC : 'transparent', border: hermesReady ? 'none' : '1.5px solid var(--fainter)' }} />{hermesLabel}</div>
        <UserMenu />
      </div>
    </aside>
  );
}
