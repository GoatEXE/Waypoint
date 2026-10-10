import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GitHubStatus, type Project } from '../api';
import { useStore } from '../store';
import { RepoSelect } from '../components/RepoSelect';

function ProjectSettings({ project, github, onSaved }: { project: Project; github: GitHubStatus | null; onSaved: () => void }) {
  const { state } = useStore();
  const [name, setName] = useState(project.name);
  const [missionId, setMissionId] = useState(project.missionId || '');
  const [repo, setRepo] = useState(project.repo || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = name.trim() !== project.name || missionId !== (project.missionId || '') || repo !== (project.repo || '');

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.updateProject(project.id, { name: name.trim(), missionId: missionId || null, repo: repo.trim() || null });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="Project settings">
      <div className="task-field-grid">
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)} />
        </label>
        {!project.missionId && <label className="field"><span className="field-label">Mission</span>
          <select className="input" value={missionId} onChange={e => setMissionId(e.target.value)}>
            <option value="">Choose a mission</option>
            {state.missions.missions.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>}
        <div className="field"><span className="field-label">GitHub repository</span>
          <RepoSelect value={repo} onChange={setRepo} github={github} />
        </div>
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
      {dirty && <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save project'}</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => { setName(project.name); setMissionId(project.missionId || ''); setRepo(project.repo || ''); }}>Discard</button>
      </div>}
    </section>
  );
}

export function ProjectView({ id }: { id: string }) {
  const { state, loadProjects, flash } = useStore();
  const nav = useNavigate();
  const [github, setGithub] = useState<GitHubStatus | null>(null);
  const project = state.projects.find(p => p.id === id);

  useEffect(() => { api.githubStatus().then(setGithub).catch(() => undefined); }, [id]);

  if (!project) {
    return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">PROJECT</div><h1 className="h1">{state.projects.length ? 'Project not found' : 'Loading project…'}</h1></div>;
  }
  const mission = state.missions.missions.find(m => m.id === project.missionId);
  const remove = async () => {
    if (!window.confirm(`Delete project ${project.name}? The repository itself is not touched.`)) return;
    try { await api.deleteProject(project.id); await loadProjects(); flash(`Deleted ${project.name}`); nav('/'); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 24 }}>
      <div className="page-head">
        <div className="eyebrow">PROJECT</div>
        <h1 className="h1">{project.name}</h1>
        <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>
          {mission ? <>Part of <span className="ul" onClick={() => nav('/')}>{mission.title}</span></> : 'Not attached to a mission'}
          {project.repo && <> · <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer" className="mono">{project.repo}</a></>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -12 }}>
        <button className="btn btn-ghost sm" onClick={() => void remove()}>Delete project</button>
      </div>

      <ProjectSettings key={project.updatedAt} project={project} github={github} onSaved={() => { void loadProjects(); flash('Project saved'); }} />
    </div>
  );
}
