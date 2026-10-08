import { useCallback, useEffect, useState } from 'react';
import { api, type GitHubStatus, type LocalRepoInfo, type Project } from '../api';
import type { OrgPod } from '../taskQueueModel';

function submitManifest(url: string, manifest: object) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = url;
  const field = document.createElement('input');
  field.type = 'hidden';
  field.name = 'manifest';
  field.value = JSON.stringify(manifest);
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
}

export function githubRepos(status: GitHubStatus | null) {
  return status?.installations.flatMap(i => i.repos) || [];
}

export function githubReadiness(status: GitHubStatus | null) {
  if (!status) return { label: 'Checking', on: false };
  if (!status.connected) return { label: 'Not connected', on: false };
  if (status.error) return { label: 'Needs attention', on: false };
  return githubRepos(status).length ? { label: 'Connected', on: true } : { label: 'Not installed', on: false };
}

export function useGitHubStatus() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => api.githubStatus().then(next => { setStatus(next); setError(''); }).catch(e => setError(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { void reload(); }, [reload]);
  return { status, setStatus, error, reload };
}

export function GitHubSetup({ status, setStatus, reload, loadError }: { status: GitHubStatus | null; setStatus: (s: GitHubStatus) => void; reload: () => void; loadError: string }) {
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const repos = githubRepos(status);

  const connect = async () => {
    setBusy(true); setError('');
    try {
      const { url, manifest } = await api.githubManifest(window.location.origin, owner.trim());
      submitManifest(url, manifest);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect GitHub? Seats lose GitHub access. Delete the app on GitHub too if you no longer need it.')) return;
    setBusy(true);
    try { setStatus(await api.githubDisconnect() as GitHubStatus); } finally { setBusy(false); }
  };

  return (
    <div className="provider-method-card stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="section-title">GitHub App</div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--faint)' }}>{githubReadiness(status).label}</span>
      </div>
      {(error || loadError) && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error || loadError}</div>}
      {status && !status.connected && <>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45 }}>Creates a private GitHub App with repository contents, pull request, and issue access. GitHub asks you to confirm, then you choose which repositories to install it on.</p>
        <input className="input" value={owner} onChange={e => setOwner(e.target.value)} placeholder="GitHub organization (optional)" aria-label="GitHub organization" />
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>Leave empty to create the app under your personal account.</span>
        <button className="btn btn-primary" disabled={busy} onClick={() => void connect()}>{busy ? 'Opening GitHub…' : 'Connect GitHub'}</button>
      </>}
      {status?.connected && status.app && <>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>App <a href={status.app.htmlUrl} target="_blank" rel="noreferrer" className="mono">{status.app.slug}</a>{status.app.owner ? ` · ${status.app.owner}` : ''}</div>
        {status.error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{status.error}</div>}
        {repos.length ? <div className="chips">{repos.map(r => <span key={r} className="chip mono" style={{ cursor: 'default' }}>{r}</span>)}</div> : <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>Not installed on any repository yet.</div>}
        <a className="btn btn-primary" style={{ textAlign: 'center' }} href={status.installUrl || '#'}>{repos.length ? 'Change repositories' : 'Install on repositories'}</a>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={reload}>Refresh</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
        </div>
      </>}
    </div>
  );
}

function ProjectRow({ project, pods, installedRepos, onSaved }: { project: Project; pods: OrgPod[]; installedRepos: string[]; onSaved: (p: Project) => void }) {
  const [localPath, setLocalPath] = useState(project.localPath || '');
  const [repo, setRepo] = useState(project.repo || '');
  const [seats, setSeats] = useState<string[]>(project.githubSeats || []);
  const [info, setInfo] = useState<LocalRepoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = localPath !== (project.localPath || '') || repo !== (project.repo || '') || seats.join() !== (project.githubSeats || []).join();
  const installed = !repo || installedRepos.some(r => r.toLowerCase() === repo.toLowerCase());

  const inspect = async () => {
    if (!localPath.trim()) { setInfo(null); return; }
    try {
      const found = await api.inspectLocalPath(localPath.trim());
      setInfo(found);
      if (found.repo && !repo) setRepo(found.repo);
    } catch (e) { setInfo(null); setError(e instanceof Error ? e.message : String(e)); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try { onSaved(await api.updateProject(project.id, { localPath: localPath.trim() || null, repo: repo.trim() || null, githubSeats: seats })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{project.name}</div>
      <div className="task-field-grid">
        <label className="field"><span className="field-label">Local folder</span>
          <input className="input mono" value={localPath} onChange={e => setLocalPath(e.target.value)} onBlur={() => void inspect()} placeholder="E:\Repositories\project" />
          {info && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{!info.exists ? 'Folder not found.' : !info.isGit ? 'Not a git repository.' : `Git repository on ${info.branch || 'unknown branch'}${info.repo ? ` · ${info.repo}` : info.remote ? ' · remote is not on GitHub' : ' · no origin remote'}`}</span>}
        </label>
        <label className="field"><span className="field-label">GitHub repository</span>
          <input className="input mono" value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/name" />
          {!installed && <span style={{ fontSize: 11.5, color: 'var(--text)' }}>The app is not installed on this repository yet.</span>}
        </label>
      </div>
      <div className="field"><span className="field-label">Seats with GitHub access</span>
        {pods.length ? <div className="chips">{pods.flatMap(pod => pod.seats.map(seat => {
          const address = `${pod.podId}/${seat.seatId}`;
          const on = seats.includes(address);
          return <button key={address} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setSeats(s => on ? s.filter(x => x !== address) : [...s, address])}>{pod.name} / {seat.seatId}</button>;
        }))}</div> : <span style={{ fontSize: 12, color: 'var(--faint)' }}>No pods yet.</span>}
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
      {dirty && <div><button className="btn btn-primary sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save project'}</button></div>}
    </div>
  );
}

export function ProjectRepos({ installedRepos }: { installedRepos: string[] }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pods, setPods] = useState<OrgPod[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([api.projects(), api.orgChart()]).then(([p, org]) => { setProjects(p.projects); setPods(org.pods); }).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const add = async () => {
    if (!name.trim()) return;
    try { const project = await api.createProject(name.trim()); setProjects(ps => [...ps, project]); setName(''); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <section className="card stack" style={{ padding: 16, gap: 10 }} aria-label="Project repositories">
      <div className="section-title">Project repositories</div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>Point a project at its local folder to detect the repository. Seats clone it into their own pod and push branches; your folder is never mounted into a pod.</p>
      {projects.map(project => <ProjectRow key={project.id} project={project} pods={pods} installedRepos={installedRepos} onSaved={p => setProjects(ps => ps.map(x => x.id === p.id ? p : x))} />)}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" style={{ width: 240 }} value={name} onChange={e => setName(e.target.value)} placeholder="New project name" onKeyDown={e => { if (e.key === 'Enter') void add(); }} />
        <button className="btn btn-ghost" onClick={() => void add()}>Add project</button>
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
    </section>
  );
}
