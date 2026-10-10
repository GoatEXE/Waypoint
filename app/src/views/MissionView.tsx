import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Mission, type MissionStatus } from '../api';
import { currentMission, missionStatusLabel, shortDate } from '../missionsModel';
import { useStore } from '../store';
import { statusLabel } from '../taskQueueModel';
import { errorText } from '../runtimeHealth';

function ProjectsSection({ mission }: { mission: Mission }) {
  const { state, addProject } = useStore();
  const nav = useNavigate();
  const projects = state.projects.filter(p => p.missionId === mission.id);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="section-title">Projects advancing this mission</div>
        <button className="btn btn-ghost sm" style={{ marginLeft: 'auto' }} onClick={() => addProject(mission.id)}>Add project</button>
      </div>
      {!projects.length && <div className="empty">No projects yet.</div>}
      {!!projects.length && <div className="list">
        {projects.map(p => (
          <div key={p.id} className="row link" style={{ display: 'flex', gap: 12, padding: '12px 16px', alignItems: 'baseline' }} onClick={() => nav('/projects/' + p.id)}>
            <span style={{ font: '500 13.5px var(--mono)' }}>{p.name}</span>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>{p.repo || 'No repository yet'}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--quiet)' }}>→</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

function MissionWork({ mission }: { mission: Mission }) {
  const nav = useNavigate();
  const { state } = useStore();
  const task = state.board.find(t => t.id === mission.taskId);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="section-title">Linked task</div>
      {!mission.taskId && <div className="empty">No task is linked yet.</div>}
      {mission.taskId && <div className="list">
        <div className="row link" style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '14px 16px' }} onClick={() => nav('/tasks/' + encodeURIComponent(task?.ref || mission.taskId!))}>
          <span className="task-ref">{task?.ref || mission.taskId}</span>
          <span className="ellipsis" style={{ flex: 1 }}>{task?.title || ''}</span>
          {task && <span className="task-pill">{statusLabel(task.status)}</span>}
          <span style={{ color: 'var(--quiet)' }}>→</span>
        </div>
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
  const [deleted, setDeleted] = useState(false);
  const [statusError, setStatusError] = useState('');
  const needs = pending.slice(0, 3);
  const { missions } = state;
  const mission = currentMission(missions);

  async function deleteSelectedMission() {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteMission(confirmDelete.id);
      setDeleted(true);
      setConfirmDelete(null);
      await loadMissions();
    } catch (error) {
      setDeleteError(errorText(error));
    } finally {
      setDeleting(false);
    }
  }

  const deletionControls = (
    <>
      {confirmDelete && (
        <div className="stack" style={{ gap: 10, padding: 16, border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
          <strong>Delete “{confirmDelete.title}”?</strong>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>This removes the mission only. Its tasks stay on the board.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="button" onClick={() => void deleteSelectedMission()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete mission'}</button>
            <button className="btn btn-ghost" type="button" onClick={() => { setConfirmDelete(null); setDeleteError(''); }} disabled={deleting}>Cancel</button>
          </div>
          {deleteError && <span role="alert" style={{ fontSize: 12.5 }}>{deleteError}</span>}
        </div>
      )}
      {deleted && <div role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>Mission deleted. Its tasks remain on the board.</div>}
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
          <p className="mission-lede">No mission is active. Existing tasks remain on the board. Create a smaller mission when you are ready, or ask the CEO to set one up.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn lg btn-primary" onClick={() => openModal('mission')}>Create a mission</button>
            <button className="btn lg btn-ghost" onClick={() => nav('/settings')}>Open Settings</button>
            <button className="btn lg btn-ghost" onClick={() => nav('/connectors')}>Open Connectors</button>
          </div>
        </div>
      </div>
    );
  }

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
          <label>Status <select aria-label="Mission status" value={mission.status} onChange={async (event) => { try { await api.updateMission(mission.id, event.target.value as MissionStatus); await loadMissions(); setStatusError(''); } catch (error) { setStatusError(errorText(error)); } }}>{['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'].map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></label>
          {mission.target && <span>Target <span className="v">{shortDate(mission.target)}</span></span>}
          <span>Recorded <span className="v">{shortDate(mission.createdAt)}</span></span>
        </div>
        {statusError && <div role="alert">{statusError}</div>}
      </div>

      {needs.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div className="section-title">Needs you</div>
            <span className="crumb-link" style={{ fontSize: 12.5 }} onClick={() => nav('/inbox')}>Open inbox →</span>
          </div>
          <div className="needs-grid">
            {needs.map(n => (
              <div key={n.id} className="need" onClick={() => nav('/inbox')}>
                <div className="kind">{n.kind.toUpperCase()}</div>
                <div className="title">{n.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <MissionWork mission={mission} />

      <ProjectsSection mission={mission} />

      {others.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="section-title">Other missions</div>
          <div className="list">
            {others.map(m => (
              <div key={m.id} className="row" style={{ display: 'flex', gap: 12, padding: '12px 16px', alignItems: 'baseline' }}>
                <span style={{ fontSize: 13.5 }}>{m.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{missionStatusLabel(m)}</span>
                <button className="btn btn-ghost" type="button" onClick={() => { setConfirmDelete(m); setDeleteError(''); }}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
