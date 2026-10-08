import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type LocalRepoInfo } from '../api';
import { useStore } from '../store';

export function repoHint(info: LocalRepoInfo | null) {
  if (!info) return '';
  if (!info.exists) return 'Folder not found.';
  if (!info.isGit) return 'Not a git repository.';
  return `Git repository on ${info.branch || 'unknown branch'}${info.repo ? ` · ${info.repo}` : info.remote ? ' · remote is not on GitHub' : ' · no origin remote'}`;
}

export function ProjectDialog() {
  const { state, closeModal, loadProjects, flash } = useStore();
  const nav = useNavigate();
  const missions = state.missions.missions;
  const [name, setName] = useState('');
  const [missionId, setMissionId] = useState(missions[0]?.id || '');
  const [localPath, setLocalPath] = useState('');
  const [repo, setRepo] = useState('');
  const [info, setInfo] = useState<LocalRepoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, closeModal]);

  const inspect = async () => {
    if (!localPath.trim()) { setInfo(null); return; }
    try {
      const found = await api.inspectLocalPath(localPath.trim());
      setInfo(found);
      if (found.repo && !repo) setRepo(found.repo);
      if (!name.trim() && found.root) setName(found.root.split(/[\\/]/).pop() || '');
    } catch (e) { setInfo(null); setError(e instanceof Error ? e.message : String(e)); }
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const project = await api.createProject({ name: name.trim(), missionId: missionId || null, localPath: localPath.trim() || null, repo: repo.trim() || null });
      await loadProjects();
      closeModal();
      flash(`Created project ${project.name}`);
      nav('/projects/' + project.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) closeModal(); }}>
      <form className="modal" style={{ padding: 22, gap: 16 }} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">NEW PROJECT</div>
          <h2 className="h1" style={{ fontSize: 20 }}>Add a project to a mission</h2>
        </div>
        <label className="field"><span className="field-label">Mission</span>
          <select className="input" value={missionId} onChange={e => setMissionId(e.target.value)} disabled={busy}>
            {!missions.length && <option value="">No mission yet</option>}
            {missions.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Local folder</span>
          <input className="input mono" autoFocus value={localPath} onChange={e => setLocalPath(e.target.value)} onBlur={() => void inspect()} placeholder="E:\Repositories\project" disabled={busy} />
          {info && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{repoHint(info)}</span>}
        </label>
        <label className="field"><span className="field-label">Project name</span>
          <input className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Goat Ops" disabled={busy} />
        </label>
        <label className="field"><span className="field-label">GitHub repository</span>
          <input className="input mono" value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/name (detected from the folder)" disabled={busy} />
        </label>
        {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeModal}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create project'}</button>
        </div>
      </form>
    </div>
  );
}
