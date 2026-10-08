import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GitHubStatus, type LocalRepoInfo } from '../api';
import { useStore } from '../store';
import { FolderPicker } from './FolderPicker';
import { RepoSelect } from './RepoSelect';

export function repoHint(info: LocalRepoInfo | null) {
  if (!info) return '';
  if (!info.exists) return 'Folder not found.';
  if (!info.isGit) return 'Not a git repository.';
  return `Git repository on ${info.branch || 'unknown branch'}${info.repo ? ` · ${info.repo}` : info.remote ? ' · remote is not on GitHub' : ' · no origin remote'}`;
}

export function FolderField({ value, onChange, info, onInspect, disabled }: { value: string; onChange: (path: string) => void; info: LocalRepoInfo | null; onInspect: (path: string) => void; disabled?: boolean }) {
  const [browsing, setBrowsing] = useState(false);
  return (
    <div className="field"><span className="field-label">Local folder</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input mono" style={{ flex: 1, minWidth: 0 }} value={value} onChange={e => onChange(e.target.value)} onBlur={() => onInspect(value)} placeholder="E:\Repositories\project" disabled={disabled} />
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => setBrowsing(v => !v)}>Browse…</button>
      </div>
      {browsing && <FolderPicker value={value} onClose={() => setBrowsing(false)} onPick={path => { setBrowsing(false); onChange(path); onInspect(path); }} />}
      {info && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{repoHint(info)}</span>}
    </div>
  );
}

export function ProjectDialog() {
  const { state, closeModal, loadProjects, flash } = useStore();
  const nav = useNavigate();
  const mission = state.missions.missions.find(m => m.id === state.projectMission);
  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [repo, setRepo] = useState('');
  const [info, setInfo] = useState<LocalRepoInfo | null>(null);
  const [github, setGithub] = useState<GitHubStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.githubStatus().then(setGithub).catch(() => setGithub({ connected: false, app: null, installUrl: null, installations: [] })); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, closeModal]);

  const inspect = async (path: string) => {
    if (!path.trim()) { setInfo(null); return; }
    try {
      const found = await api.inspectLocalPath(path.trim());
      setInfo(found);
      if (found.repo) setRepo(current => current || found.repo || '');
      if (found.root) setName(current => current || found.root!.split(/[\\/]/).pop() || '');
    } catch (e) { setInfo(null); setError(e instanceof Error ? e.message : String(e)); }
  };

  const submit = async () => {
    if (!name.trim() || busy || !mission) return;
    setBusy(true); setError('');
    try {
      const project = await api.createProject({ name: name.trim(), missionId: mission.id, localPath: localPath.trim() || null, repo: repo.trim() || null });
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
        <FolderField value={localPath} onChange={setLocalPath} info={info} onInspect={path => void inspect(path)} disabled={busy} />
        <label className="field"><span className="field-label">Project name</span>
          <input className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Goat Ops" disabled={busy} />
        </label>
        <div className="field"><span className="field-label">GitHub repository</span>
          <RepoSelect value={repo} onChange={setRepo} github={github} disabled={busy} />
        </div>
        {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeModal}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !mission}>{busy ? 'Adding…' : 'Add project'}</button>
        </div>
      </form>
    </div>
  );
}
