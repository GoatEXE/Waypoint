import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { ACC, missionPct, projStats, seatStatus } from '../model';
import { activeProject, useRoute, type View } from '../routes';
import { useStore } from '../store';
import { Dot, OnDot } from './ui';
import { api, type HermesStatus, type MissionPod, type TaskSummary } from '../api';
import { sidebarHermesSummary } from '../hermesSidebarStatus';
import { missionPods, sidebarMissionLabel } from '../missionsModel';

// [view, label, icon width, icon height, icon radius, icon rotation]
const WORKSPACE: [View, string, number, number, string, number][] = [
  ['inbox', 'Inbox', 12, 9, '2px', 0],
  ['routines', 'Routines', 11, 11, '50%', 0],
  ['artifacts', 'Artifacts', 10, 10, '2px', 0],
  ['skills', 'Skills', 8, 8, '1px', 45],
  ['connectors', 'Connectors', 12, 7, '4px', 0],
  ['settings', 'Settings', 12, 12, '50%', 0],
];

function AddButton({ onClick }: { onClick: () => void }) {
  return <button className="sb-add" title="New" onClick={onClick}>+</button>;
}

export function Sidebar() {
  const { state, set, setPane, openModal, tasks } = useStore();
  const nav = useNavigate();
  const route = useRoute();
  const activeProj = activeProject(route);
  const activePod = route.v === 'pod' || route.v === 'review' ? route.id : null;
  const [hermes, setHermes] = useState<HermesStatus | null>(null);
  const [hermesChecked, setHermesChecked] = useState(false);
  const [orgPods, setOrgPods] = useState<MissionPod[] | null>(null);
  const [storedTasks, setStoredTasks] = useState<TaskSummary[]>([]);
  const [deliveryAttention, setDeliveryAttention] = useState(0);
  useEffect(() => {
    api.hermesStatus({ freshAuth: true }).then(s => { setHermes(s); setHermesChecked(true); }).catch(() => { setHermes(null); setHermesChecked(true); });
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [chart, taskList, deliveries] = await Promise.all([api.orgChart(), api.tasks(), api.messageDeliveries().catch(() => null)]);
        if (!active) return;
        setOrgPods(chart.pods.map(pod => ({ id: pod.podId, podName: pod.name, templateId: '', state: pod.state, seats: pod.seats.map(seat => ({ id: seat.seatId, role: seat.role })) })));
        setStoredTasks(taskList.tasks);
        if (deliveries) setDeliveryAttention(deliveries.messages.filter(message => !message.readAt && ['failed', 'outcome_unknown'].includes(message.wake?.state || '')).length);
      } catch { /* keep last known navigation */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [state.missions.missions]);
  const { label: hermesLabel, ready: hermesReady } = sidebarHermesSummary(hermes, hermesChecked);
  const missionLabel = sidebarMissionLabel(state.missions);
  const pods = orgPods ?? missionPods(state.missions.missions);

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
              {D.projects.length > 0 && <span className="sb-meta">{missionPct(tasks)}%</span>}
            </div>
          </div>
          {state.missionOpen && (
            <div className="sb-children">
              {!D.projects.length && <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default' }}>No projects</div>}
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
          {!D.pods.length && !pods.length && <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default' }}>No pods</div>}
          {pods.map(p => (
            <div key={p.id} className={'sb-item' + (activePod === p.id ? ' active' : '')} style={{ color: 'var(--text)' }} title={p.state === 'running' ? 'Running' : 'Not running'} onClick={() => nav('/pods/' + p.id)}>
              <OnDot on={p.state === 'running'} />
              <span className="sb-name">{p.podName}</span>
              <span className="sb-meta">{p.seats.length}</span>
            </div>
          ))}
          {D.pods.map(p => {
            const stopped = state.podStopped && p.name === activePod;
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
          {!D.seats.length && !pods.length && <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default' }}>No seats</div>}
          {pods.flatMap(p => p.seats.map(s => (
            <div key={p.id + s.id} className={'sb-item seat' + (activePod === p.id ? ' active' : '')} title={`${p.podName} · ${p.state === 'running' ? 'running' : 'not running'}`} onClick={() => nav('/pods/' + p.id)}>
              <OnDot on={p.state === 'running'} />
              <span className="sb-name c-text3">{s.id}</span>
              <span className="sb-role">{s.role}</span>
            </div>
          )))}
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
        <div className="sb-section">
          <div className="sb-label-row"><span className="sb-label">TASKS</span></div>
          {!storedTasks.length && <div className="sb-item" style={{ color: 'var(--faint)', cursor: 'default' }}>No tasks</div>}
          {storedTasks.slice(0, 12).map(task => (
            <div key={task.id} className={'sb-item' + (route.v === 'task' && route.id === task.id ? ' active' : '')} title={task.summary} onClick={() => nav('/tasks/' + task.id)}>
              <span className="sb-name ellipsis">{task.summary}</span>
              <span className="sb-meta">{task.state.replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-footer">
        <div><div style={{ width: 6, height: 6, borderRadius: '50%', background: hermesReady ? ACC : 'transparent', border: hermesReady ? 'none' : '1.5px solid var(--fainter)' }} />{hermesLabel}</div>
        <div><div style={{ width: 6, height: 6, borderRadius: '50%', border: '1.5px solid var(--fainter)' }} />Provider auth in Connectors</div>
      </div>
    </aside>
  );
}
