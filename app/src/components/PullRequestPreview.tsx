import { useEffect, useState } from 'react';
import { api, type DevPreview, type DevStatus } from '../api';
import { errorText } from '../runtimeHealth';

export function prNumberFor(url: string | null | undefined, repo: string | null | undefined): number | null {
  const match = String(url || '').match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)/);
  if (!match || !repo || match[1].toLowerCase() !== repo.toLowerCase()) return null;
  return Number(match[2]);
}

export function PullRequestPreview({ url }: { url: string }) {
  const [dev, setDev] = useState<DevStatus | null>(null);
  const [preview, setPreview] = useState<DevPreview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.devStatus().then(s => { setDev(s); setPreview(s.preview || null); }).catch(() => undefined); }, [url]);
  const pr = prNumberFor(url, dev?.repo);
  const mine = preview && preview.pr === pr ? preview : null;
  useEffect(() => {
    if (mine?.state !== 'starting') return;
    const timer = window.setInterval(() => { api.devStatus().then(s => setPreview(s.preview || null)).catch(() => undefined); }, 2000);
    return () => window.clearInterval(timer);
  }, [mine?.state]);
  if (!dev?.enabled || !pr) return null;

  const start = async () => { setError(''); try { setPreview(await api.startPreview(pr)); } catch (e) { setError(errorText(e)); } };
  const stop = async () => { setError(''); try { await api.stopPreview(); setPreview(null); } catch (e) { setError(errorText(e)); } };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <a className="mono" href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>PR #{pr}</a>
        {!mine && <button className="btn btn-ghost sm" onClick={() => void start()}>Preview</button>}
        {mine?.state === 'starting' && <span className="field-hint">Starting the preview…</span>}
        {mine?.state === 'running' && mine.url && <a className="btn btn-primary sm" href={mine.url} target="_blank" rel="noreferrer">Open preview ↗</a>}
        {mine && <button className="btn btn-ghost sm" onClick={() => void stop()}>Close preview</button>}
      </div>
      {mine?.state === 'needs-service' && <div className="field-hint">This PR changes the service ({mine.files.filter(f => f.startsWith('service/')).length} files), so the preview needs a separate service. Test it after merging with Update &amp; restart.</div>}
      {mine?.state === 'failed' && <div className="form-error">Preview failed: {mine.error}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}
    </div>
  );
}
