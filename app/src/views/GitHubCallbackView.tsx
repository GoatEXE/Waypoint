import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';

export function GitHubCallbackView({ step }: { step: string }) {
  const nav = useNavigate();
  const { flash } = useStore();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    if (step === 'installed') {
      flash('GitHub installation updated');
      nav('/connectors', { replace: true });
      return;
    }
    api.githubComplete(params.get('code') || '', params.get('state') || '')
      .then(status => {
        if (status.installUrl) window.location.assign(status.installUrl);
        else nav('/connectors', { replace: true });
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [flash, nav, step]);

  return (
    <div className="page" style={{ maxWidth: 720, gap: 12 }}>
      <div className="eyebrow">GITHUB</div>
      <h1 className="h1">{error ? 'GitHub setup did not finish' : 'Finishing GitHub setup…'}</h1>
      {error ? <><p className="lede" role="alert">{error}</p><div><button className="btn btn-ghost" onClick={() => nav('/connectors')}>Back to Connectors</button></div></> : <p className="lede">Saving the Waypoint GitHub App, then opening GitHub to choose repositories.</p>}
    </div>
  );
}
