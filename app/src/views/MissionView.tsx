import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { api, type Mission } from '../api';
import { projStats } from '../model';
import { currentMission, missionStatus, podStateLabel, shortDate, taskStateLabel } from '../missionsModel';
import { useStore } from '../store';
import { OnDot } from '../components/ui';

function ProjectsSection() {
  const { tasks } = useStore();
  const nav = useNavigate();
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="section-title">Projects advancing this mission</div>
      {!D.projects.length && <div className="empty">No projects yet.</div>}
      {!!D.projects.length && <div className="list">
        {D.projects.map(p => {
          const s = projStats(p, tasks);
          return (
            <div key={p.id} className="row link proj-row" onClick={() => nav('/projects/' + p.id)}>
              <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                <div style={{ font: '500 13.5px var(--mono)' }}>{p.name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>{p.goal}</div>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--dim)' }}>
                  <span>{s.done} of {s.total} done</span><span className="mono">{s.pct}%</span>
                </div>
                <div className="bar" style={{ background: 'var(--border)' }}><div style={{ width: s.pct + '%', background: 'var(--text-3)' }} /></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                <span>{s.flag}</span>
                <span style={{ color: 'var(--quiet)' }}>→</span>
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

function MissionWork({ mission }: { mission: Mission }) {
  const { pod, task } = mission;
  const nav = useNavigate();
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="section-title">Who is on it</div>
      {!pod && !task && <div className="empty">No pod or task is assigned yet.</div>}
      {(pod || task) && <div className="list">
        {pod && (
          <div className="row stack link" style={{ padding: '14px 16px', gap: 8 }} onClick={() => nav('/pods/' + pod.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="sb-label" style={{ color: 'var(--dim)' }}>POD</span>
              <OnDot on={pod.state === 'running'} />
              <span style={{ font: '500 13.5px var(--mono)' }}>{pod.podName}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{podStateLabel(pod.state)} →</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)' }}>
              {pod.seats.length ? pod.seats.map(s => `${s.id} (${s.role})`).join(' · ') : 'No seats'}
            </div>
          </div>
        )}
        {task && (
          <div className="row stack link" style={{ padding: '14px 16px', gap: 8 }} onClick={() => nav('/tasks/' + task.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="sb-label" style={{ color: 'var(--dim)' }}>TASK</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>To the <span className="mono">{task.seatId}</span> seat</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{taskStateLabel(task.state)} →</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.45 }}>{task.summary}</div>
            <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Handed off {shortDate(task.updatedAt)}</div>
          </div>
        )}
      </div>}
    </div>
  );
}

export function MissionView() {
  const { state, pending, openModal, loadMissions } = useStore();
  const nav = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState<Mission | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletedLinks, setDeletedLinks] = useState<{ podId: string | null; taskId: string | null } | null>(null);
  const needs = pending.slice(0, 3);
  const { missions } = state;
  const mission = currentMission(missions);

  async function deleteSelectedMission() {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const result = await api.deleteMission(confirmDelete.id);
      setDeletedLinks({ podId: result.podId, taskId: result.taskId });
      setConfirmDelete(null);
      await loadMissions();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  }

  const deletionControls = (
    <>
      {confirmDelete && (
        <div className="stack" style={{ gap: 10, padding: 16, border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
          <strong>Delete “{confirmDelete.title}”?</strong>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>This removes the mission only. Its pod and task records stay available.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="button" onClick={() => void deleteSelectedMission()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete mission'}</button>
            <button className="btn btn-ghost" type="button" onClick={() => { setConfirmDelete(null); setDeleteError(''); }} disabled={deleting}>Cancel</button>
          </div>
          {deleteError && <span role="alert" style={{ fontSize: 12.5 }}>{deleteError}</span>}
        </div>
      )}
      {deletedLinks && (
        <div role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>
          Mission deleted. Any linked pod and task records remain.
          {deletedLinks.podId && <button className="btn btn-ghost" type="button" onClick={() => nav('/pods/' + deletedLinks.podId)}>Open pod</button>}
          {deletedLinks.taskId && <button className="btn btn-ghost" type="button" onClick={() => nav('/tasks/' + deletedLinks.taskId)}>Open task</button>}
        </div>
      )}
    </>
  );

  if (missions.status === 'loading' && !missions.missions.length) {
    return (
      <div className="page" style={{ maxWidth: 920, paddingTop: 48, gap: 14 }}>
        <div className="eyebrow">MISSION</div>
        <p className="mission-lede" role="status">Loading your mission…</p>
      </div>
    );
  }

  if (missions.status === 'error') {
    return (
      <div className="page" style={{ maxWidth: 920, paddingTop: 48, gap: 14 }}>
        <div className="eyebrow">MISSION</div>
        <h1 className="mission-h1">Couldn't load your mission</h1>
        <p className="mission-lede" role="alert">The Waypoint service did not answer: {missions.error}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn lg btn-primary" onClick={() => void loadMissions()}>Try again</button>
        </div>
      </div>
    );
  }

  if (!mission) {
    return (
      <div className="page" style={{ maxWidth: 920, paddingTop: 48, gap: 28 }}>
        <div className="stack" style={{ gap: 14 }}>
          <div className="eyebrow">MISSION</div>
          <h1 className="mission-h1">No mission yet</h1>
          {deletionControls}
          <p className="mission-lede">No mission is active. Existing pods and tasks remain available in the sidebar. Create a smaller mission when you are ready, or ask the CEO to set one up.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn lg btn-primary" onClick={() => openModal('mission')}>Create a mission</button>
            <button className="btn lg btn-ghost" onClick={() => nav('/settings')}>Open Settings</button>
            <button className="btn lg btn-ghost" onClick={() => nav('/connectors')}>Open Connectors</button>
          </div>
        </div>
        <ProjectsSection />
      </div>
    );
  }

  const status = missionStatus(mission);
  const others = missions.missions.slice(1);

  return (
    <div className="page" style={{ maxWidth: 920, paddingTop: 48, gap: 44 }}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="eyebrow">MISSION</div>
        <h1 className="mission-h1">{mission.title}</h1>
        <div><button className="btn btn-ghost" type="button" onClick={() => { setConfirmDelete(mission); setDeleteError(''); }}>Delete mission</button></div>
        {deletionControls}
        {mission.outcome && <p className="mission-lede">{mission.outcome}</p>}
        <div className="meta-row" style={{ gap: '8px 22px', marginTop: 4 }}>
          <span>Status <span className="v">{status.label}</span></span>
          {mission.target && <span>Target <span className="v">{shortDate(mission.target)}</span></span>}
          <span>Recorded <span className="v">{shortDate(mission.createdAt)}</span></span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{status.detail}</div>
      </div>

      {needs.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div className="section-title">Needs you</div>
            <span className="crumb-link" style={{ fontSize: 12.5 }} onClick={() => nav('/inbox')}>Open inbox →</span>
          </div>
          <div className="needs-grid">
            {needs.map(n => (
              <div key={n.id} className="need" onClick={() => nav(n.review ? '/pods/' + (D.pods[0]?.name || '') + '/review' : '/inbox')}>
                <div className="kind">{n.kind.toUpperCase()}</div>
                <div className="title">{n.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <MissionWork mission={mission} />

      <ProjectsSection />

      {others.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="section-title">Other missions</div>
          <div className="list">
            {others.map(m => (
              <div key={m.id} className="row" style={{ display: 'flex', gap: 12, padding: '12px 16px', alignItems: 'baseline' }}>
                <span style={{ fontSize: 13.5 }}>{m.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{missionStatus(m).label}</span>
                <button className="btn btn-ghost" type="button" onClick={() => { setConfirmDelete(m); setDeleteError(''); }}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
