import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ACC } from '../model';
import { activeProject, useRoute, type View } from '../routes';
import { useStore } from '../store';
import { NavIcon, type NavIconName } from './NavIcon';
import { api, type HermesStatus, type OrgSeat, type TaskSummary } from '../api';
import { sidebarHermesSummary } from '../hermesSidebarStatus';
import { sidebarMissionLabel } from '../missionsModel';
import { ceoNameOf } from '../orgModel';

const WORKSPACE: [View & NavIconName, string][] = [
  ['tasks', 'Tasks'],
  ['org', 'Organization'],
  ['inbox', 'Inbox'],
  ['routines', 'Routines'],
  ['artifacts', 'Artifacts'],
  ['skills', 'Skills'],
  ['connectors', 'Connectors'],
];

function AddButton({ onClick }: { onClick: () => void }) {
  return <button className="sb-add" title="New" onClick={onClick}>+</button>;
}

export function Sidebar() {
  const { state, set, openModal } = useStore();
  const nav = useNavigate();
  const route = useRoute();
  const activeProj = activeProject(route);
  const [hermes, setHermes] = useState<HermesStatus | null>(null);
  const [hermesChecked, setHermesChecked] = useState(false);
  const [seats, setSeats] = useState<OrgSeat[]>([]);
  const [storedTasks, setStoredTasks] = useState<TaskSummary[]>([]);
  const [deliveryAttention, setDeliveryAttention] = useState(0);
  useEffect(() => {
    api.hermesStatus({ freshAuth: true }).then(s => { setHermes(s); setHermesChecked(true); }).catch(() => { setHermes(null); setHermesChecked(true); });
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [orgSeats, taskList, deliveries] = await Promise.all([api.orgSeats().catch(() => ({ seats: [] as OrgSeat[] })), api.tasks(), api.messageDeliveries().catch(() => null)]);
        if (!active) return;
        setSeats(orgSeats.seats);
        setStoredTasks(taskList.tasks);
        setDeliveryAttention((deliveries ? deliveries.messages.filter(message => !message.readAt && ['failed', 'outcome_unknown'].includes(message.wake?.state || '')).length : 0) + taskList.tasks.filter(task => task.status === 'in_review').length);
      } catch {   }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [state.missions.missions]);
  const { label: hermesLabel, ready: hermesReady } = sidebarHermesSummary(hermes, hermesChecked);
  const missionLabel = sidebarMissionLabel(state.missions);
  const currentMissionId = state.missions.missions[0]?.id;
  const missionProjects = state.projects.filter(p => currentMissionId && p.missionId === currentMissionId);
  const unfiledProjects = state.projects.filter(p => !p.missionId || !state.missions.missions.some(m => m.id === p.missionId));
  const openCount = (projectId: string) => storedTasks.filter(t => t.projectId === projectId && t.status !== 'done' && t.status !== 'canceled').length;

  return (
    <aside className="sidebar">
      <div className="brand">
        {state.org.organization?.logo ? <img className="brand-logo" src={state.org.organization.logo} alt="" /> : <div className="brand-mark" />}
        <div className="brand-name" title={state.org.organization?.name}>{state.org.organization?.name || 'Waypoint'}</div>
      </div>
      <div className="new-assign-wrap">
        <button className="new-assign" onClick={() => openModal('assignment')}>
          <span className="plus">+</span>New task
          <span className="tag">{ceoNameOf(state.org.organization)}</span>
        </button>
      </div>

      <div className="sb-scroll">
        <div className="sb-section">
          <div className="sb-label sb-label-pad">WORKSPACE</div>
          {WORKSPACE.map(([v, label]) => (
            <div key={v} className={'sb-item' + (route.v === v ? ' active' : '')} onClick={() => nav('/' + v)}>
              <div className="sb-icon"><NavIcon name={v} /></div>
              <span>{label}</span>
              {v === 'inbox' && deliveryAttention > 0 && <span className="sb-count">{deliveryAttention}</span>}
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
              <span className="ellipsis" style={{ fontWeight: 500 }} title={missionLabel}>{missionLabel}</span>
              {missionProjects.length > 0 && <span className="sb-meta">{missionProjects.length}</span>}
            </div>
          </div>
          {state.missionOpen && (
            <div className="sb-children">
              {missionProjects.map(p => (
                <div key={p.id} className={'sb-item' + (activeProj === p.id ? ' active' : '')} onClick={() => nav('/projects/' + p.id)}>
                  <span className="sb-name">{p.name}</span>
                  <span className="sb-meta">{openCount(p.id) || ''}</span>
                </div>
              ))}
              {unfiledProjects.length > 0 && <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default', fontSize: 11 }}>Not in a mission</div>}
              {unfiledProjects.map(p => (
                <div key={p.id} className={'sb-item' + (activeProj === p.id ? ' active' : '')} style={{ color: 'var(--muted)' }} onClick={() => nav('/projects/' + p.id)}>
                  <span className="sb-name">{p.name}</span>
                  <span className="sb-meta">{openCount(p.id) || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">PODS</span></div>
          <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default' }}>No pods</div>
        </div>

        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">SEATS</span><AddButton onClick={() => openModal('seat')} /></div>
          {!seats.length && <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default' }}>No seats</div>}
          {seats.map(seat => (
            <div key={seat.id} className={'sb-item seat' + (route.v === 'org' ? ' active' : '')} title={seat.description} onClick={() => nav('/org')}>
              <span className="sb-name c-text3">{seat.id}</span>
              <span className="sb-role ellipsis">{seat.description}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-footer">
        <div><div style={{ width: 6, height: 6, borderRadius: '50%', background: hermesReady ? ACC : 'transparent', border: hermesReady ? 'none' : '1.5px solid var(--fainter)' }} />{hermesLabel}</div>
        <div className={'sb-item' + (route.v === 'settings' ? ' active' : '')} onClick={() => nav('/settings')}>
          <div className="sb-icon"><NavIcon name="settings" /></div>
          <span>Settings</span>
        </div>
      </div>
    </aside>
  );
}
