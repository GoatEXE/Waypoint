import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GitHubStatus, type Project } from '../api';
import { useStore } from '../store';
import { RepoSelect } from '../components/RepoSelect';
import { errorText } from '../runtimeHealth';
import { ProjectTaskList, StatusCounts } from '../components/ProjectTasks';
import { projectTasks } from '../projectProgress';
import { NewTaskDialog } from './TasksView';
import type { OrgSeat } from '../api';

function ProjectSettings({ project, github, onSaved, onCancel }: { project: Project; github: GitHubStatus | null; onSaved: () => void; onCancel: () => void }) {
  const { state } = useStore();
  const [name, setName] = useState(project.name);
  const savedMission = state.missions.missions.some(m => m.id === project.missionId) ? project.missionId || '' : '';
  const [missionId, setMissionId] = useState(savedMission);
  const [repo, setRepo] = useState(project.repo || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = name.trim() !== project.name || missionId !== savedMission || repo !== (project.repo || '');

  const save = async () => {
    setBusy(true); setError('');
    if (!dirty) { onCancel(); setBusy(false); return; }
    try {
      await api.updateProject(project.id, { name: name.trim(), missionId: missionId || null, repo: repo.trim() || null });
      onSaved();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="Project settings">
      <div className="task-field-grid">
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)} />
        </label>
        <label className="field"><span className="field-label">Mission</span>
          <select className="input" value={missionId} onChange={e => setMissionId(e.target.value)}>
            <option value="">Not in a mission</option>
            {state.missions.missions.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>
        <div className="field"><span className="field-label">GitHub repository</span>
          <RepoSelect value={repo} onChange={setRepo} github={github} />
        </div>
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

export function ProjectView({ id }: { id: string }) {
  const { state, loadProjects, loadBoard, flash } = useStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [seats, setSeats] = useState<OrgSeat[]>([]);
  const nav = useNavigate();
  const [github, setGithub] = useState<GitHubStatus | null>(null);
  const project = state.projects.find(p => p.id === id);

  useEffect(() => { setEditing(false); setConfirmDelete(false); }, [id]);
  useEffect(() => { api.githubStatus().then(setGithub).catch(() => undefined); api.orgSeats().then(r => setSeats(r.seats)).catch(() => undefined); void loadBoard(); }, [id, loadBoard]);

  if (!project) {
    return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">PROJECT</div><h1 className="h1">{state.projects.length ? 'Project not found' : 'Loading project…'}</h1></div>;
  }
  const mission = state.missions.missions.find(m => m.id === project.missionId);
  const tasks = projectTasks(state.board, [project.id]);
  const remove = async () => {
    setDeleting(true);
    try { await api.deleteProject(project.id); await loadProjects(); flash(`Deleted ${project.name}`); nav('/'); }
    catch (e) { flash(errorText(e)); setDeleting(false); }
  };

  if (editing) {
    return (
      <div className="page" style={{ maxWidth: 920, gap: 24 }}>
        <div className="eyebrow">EDIT PROJECT</div>
        <ProjectSettings key={project.updatedAt} project={project} github={github} onCancel={() => setEditing(false)} onSaved={() => { void loadProjects(); flash('Project saved'); setEditing(false); }} />
        <div className="stack danger-zone" style={{ gap: 12 }}>
          <div className="section-title">Danger zone</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>Deleting removes the project from Waypoint. The GitHub repository and its tasks stay.</span>
            {confirmDelete
              ? <span style={{ display: 'flex', gap: 8 }}><button className="btn btn-ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button><button className="btn btn-primary" disabled={deleting} onClick={() => void remove()}>{deleting ? 'Deleting…' : `Delete ${project.name}`}</button></span>
              : <button className="btn btn-ghost danger" type="button" onClick={() => setConfirmDelete(true)}>Delete project</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 24 }}>
      <div className="page-head">
        <div className="eyebrow">PROJECT</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <h1 className="h1">{project.name}</h1>
          <button type="button" className="icon-btn" style={{ marginTop: 2 }} title="Edit project" aria-label="Edit project" onClick={() => setEditing(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>
          {mission ? <>Part of <span className="ul" onClick={() => nav('/')}>{mission.title}</span></> : 'Not attached to a mission'}
          {project.repo && <> · <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer" className="mono">{project.repo}</a></>}
        </div>
      </div>

      <section className="stack" style={{ gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="section-title">Tasks</div>
          <StatusCounts tasks={tasks} />
          <button className="btn btn-ghost sm" style={{ marginLeft: 'auto' }} disabled={!project.repo} title={project.repo ? undefined : 'Add a GitHub repository first'} onClick={() => setAdding(true)}>Add task</button>
        </div>
        <ProjectTaskList tasks={tasks} limit={50} />
      </section>
      {adding && <NewTaskDialog tasks={state.board} seats={seats} initialProject={project.id} onClose={() => setAdding(false)}
        onCreated={async () => { setAdding(false); flash(`Added a task to ${project.name}`); await loadBoard(); }} />}
    </div>
  );
}
