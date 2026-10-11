import { useCallback, useEffect, useState } from 'react';
import { api, type GitHubStatus } from '../api';
import { errorText } from '../runtimeHealth';

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
  const reload = useCallback((fresh = false) => api.githubStatus(fresh).then(next => { setStatus(next); setError(''); }).catch(e => setError(errorText(e))), []);
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
    } catch (e) { setError(errorText(e)); setBusy(false); }
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
        <input className="input" value={owner} onChange={e => setOwner(e.target.value)} placeholder="GitHub organization (optional)" aria-label="GitHub organization" />
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
