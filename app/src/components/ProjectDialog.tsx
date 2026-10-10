import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GitHubStatus } from '../api';
import { useStore } from '../store';
import { RepoSelect } from './RepoSelect';

export function ProjectDialog() {
  const { state, closeModal, loadProjects, flash } = useStore();
  const nav = useNavigate();
  const mission = state.missions.missions.find(m => m.id === state.projectMission);
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const [github, setGithub] = useState<GitHubStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.githubStatus().then(setGithub).catch(() => setGithub({ connected: false, app: null, installUrl: null, installations: [] })); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, closeModal]);

  const submit = async () => {
    if (!name.trim() || !repo.trim() || busy || !mission) return;
    setBusy(true); setError('');
    try {
      const project = await api.createProject({ name: name.trim(), missionId: mission.id, repo: repo.trim() });
      await loadProjects();
      closeModal();
      flash(`Added ${project.name} to ${mission.title}`);
      nav('/projects/' + project.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) closeModal(); }}>
      <form className="modal" style={{ padding: 22, gap: 16 }} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">NEW PROJECT · {mission ? mission.title.toUpperCase() : 'NO MISSION'}</div>
          <h2 className="h1" style={{ fontSize: 20 }}>Add a project</h2>
        </div>
        {!mission && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>Open a mission and add the project from there.</div>}
        <label className="field"><span className="field-label">Project name</span>
          <input className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Goat Ops" disabled={busy} />
        </label>
        <div className="field"><span className="field-label">GitHub repository</span>
          <RepoSelect value={repo} onChange={setRepo} github={github} disabled={busy} />
        </div>
        {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeModal}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !repo.trim() || !mission}>{busy ? 'Adding…' : 'Add project'}</button>
        </div>
      </form>
    </div>
  );
}
