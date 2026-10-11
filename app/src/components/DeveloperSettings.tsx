import { useEffect, useState } from 'react';
import { api, type DevStatus } from '../api';
import { errorText } from '../runtimeHealth';

async function waitForRestart(requestedAt: string) {
  for (let i = 0; i < 120; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const next = await api.devStatus().catch(() => null);
    if (next?.lastUpdate && next.lastUpdate.at >= requestedAt) return next;
  }
  return null;
}

export function DeveloperSettings() {
  const [status, setStatus] = useState<DevStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async (refresh = false) => {
    try { setStatus(await api.devStatus(refresh)); setError(''); }
    catch (e) { setError(errorText(e)); }
  };
  useEffect(() => { void load(); }, []);

  const toggle = async () => {
    if (!status) return;
    setBusy('toggle');
    try { setStatus(await api.setDevMode(!status.enabled)); setError(''); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };
  const update = async () => {
    setBusy('update'); setError('');
    try {
      const { requestedAt } = await api.requestUpdate();
      const next = await waitForRestart(requestedAt);
      if (!next) { setError('Waypoint did not come back within four minutes. Check the terminal running npm start.'); return; }
      if (next.lastUpdate && !next.lastUpdate.ok) { setStatus(next); setError(`Update failed: ${next.lastUpdate.error}`); return; }
      window.location.reload();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };

  return (
    <section className="card stack" style={{ padding: 16, gap: 12 }} aria-label="Developer mode">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="stack" style={{ gap: 4, flex: 1 }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Developer mode</h2>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Update Waypoint from main and preview its pull requests from approvals.</span>
        </div>
        <button className={'switch' + (status?.enabled ? '' : ' off')} role="switch" aria-checked={Boolean(status?.enabled)} aria-label="Developer mode" disabled={!status || !!busy} onClick={() => void toggle()}><div /></button>
      </div>
      {status?.enabled && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="meta-row" style={{ gap: '6px 18px' }}>
            {status.repo && <span>Repo <span className="v mono">{status.repo}</span></span>}
            <span>Branch <span className="v mono">{status.branch}</span></span>
            <span>Running <span className="v mono">{status.head}</span></span>
          </div>
          {status.behind ? (
            <div className="stack" style={{ gap: 6 }}>
              <div style={{ fontSize: 13 }}>{status.behind} new commit{status.behind === 1 ? '' : 's'} on main</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-2)' }}>
                {status.commits.map(c => <li key={c.sha}><span className="mono" style={{ color: 'var(--faint)' }}>{c.sha}</span> {c.subject}</li>)}
              </ul>
            </div>
          ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>Up to date with main.</div>}
          {status.blockers.length > 0 && <div className="field-hint">{status.blockers.join(' ')}</div>}
          {status.fetchError && <div className="field-hint">Couldn't check GitHub: {status.fetchError}</div>}
          {status.lastUpdate && !status.lastUpdate.ok && <div className="form-error">Last update failed: {status.lastUpdate.error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={!status.canUpdate || !!busy} onClick={() => void update()}>{busy === 'update' ? 'Updating and restarting…' : 'Update & restart'}</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => { setBusy('check'); void load(true).finally(() => setBusy('')); }}>{busy === 'check' ? 'Checking…' : 'Check for updates'}</button>
          </div>
        </div>
      )}
      {error && <div role="alert" className="form-error">{error}</div>}
    </section>
  );
}
