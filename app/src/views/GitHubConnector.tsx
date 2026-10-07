import { useEffect, useState } from 'react';
import { api, type GitHubStatus, type LocalRepoInfo, type Project } from '../api';
import { OnDot } from '../components/ui';
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

export function GitHubCard() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.githubStatus().then(setStatus).catch(e => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);

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

  const repos = status?.installations.flatMap(i => i.repos) || [];
  return (
    <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="GitHub">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span className="provider-mark">GH</span>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>GitHub</h2>
          <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>A Waypoint GitHub App gives designated seats short-lived access to chosen repositories.</div>
        </div>
        <span className="status-badge" style={{ marginLeft: 'auto', color: status?.connected ? 'var(--text-3)' : 'var(--faint)' }}><OnDot on={Boolean(status?.connected && repos.length)} />{!status ? 'Checking' : !status.connected ? 'Not connected' : repos.length ? 'Connected' : 'Not installed'}</span>
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
      {status && !status.connected && (
        <div className="stack" style={{ gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45 }}>Connecting creates a private GitHub App with repository contents, pull request, and issue access. GitHub asks you to confirm, then you choose which repositories to install it on.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 240 }} value={owner} onChange={e => setOwner(e.target.value)} placeholder="GitHub organization (optional)" aria-label="GitHub organization" />
            <button className="btn btn-primary" disabled={busy} onClick={() => void connect()}>{busy ? 'Opening GitHub…' : 'Connect GitHub'}</button>
          </div>
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>Leave the organization empty to create the app under your personal account.</span>
        </div>
      )}
      {status?.connected && status.app && (
        <div className="stack" style={{ gap: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>App <a href={status.app.htmlUrl} target="_blank" rel="noreferrer" className="mono">{status.app.slug}</a>{status.app.owner ? ` · owned by ${status.app.owner}` : ''}</div>
          {status.error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{status.error}</div>}
          {repos.length ? <div className="chips">{repos.map(r => <span key={r} className="chip mono" style={{ cursor: 'default' }}>{r}</span>)}</div> : <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>Not installed on any repository yet.</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href={status.installUrl || '#'}>{repos.length ? 'Change repositories' : 'Install on repositories'}</a>
            <button className="btn btn-ghost" onClick={() => void load()}>Refresh</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
          </div>
        </div>
      )}
      {status?.connected && <ProjectRepos installedRepos={repos} />}
    </section>
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

function ProjectRepos({ installedRepos }: { installedRepos: string[] }) {
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
    <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div className="section-title">Project repositories</div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>Point a project at its local folder to detect the repository. Seats clone it into their own pod and push branches; your folder is never mounted into a pod.</p>
      {projects.map(project => <ProjectRow key={project.id} project={project} pods={pods} installedRepos={installedRepos} onSaved={p => setProjects(ps => ps.map(x => x.id === p.id ? p : x))} />)}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" style={{ width: 240 }} value={name} onChange={e => setName(e.target.value)} placeholder="New project name" onKeyDown={e => { if (e.key === 'Enter') void add(); }} />
        <button className="btn btn-ghost" onClick={() => void add()}>Add project</button>
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
    </div>
  );
}
