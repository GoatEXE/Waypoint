import { useState, type MouseEvent } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { DRY_RUN_REASON } from '../dryRun';
import { errorText } from '../runtimeHealth';

export function HermesPortalLink({ target, label = 'Hermes UI' }: { target: string; label?: string }) {
  const { state } = useStore();
  const dryRun = Boolean(state.config?.dryRun);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async (event: MouseEvent) => {
    event.stopPropagation();
    const win = window.open('about:blank', '_blank');
    if (win) win.opener = null;
    setBusy(true);
    setError('');
    try {
      const { url } = await api.openHermesPortal(target);
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (err) {
      win?.close();
      setError(errorText(err));
    } finally { setBusy(false); }
  };
  return (
    <span className="portal-link" onClick={event => event.stopPropagation()}>
      <button type="button" className="btn sm btn-ghost" onClick={event => void open(event)} disabled={busy || dryRun} title={dryRun ? DRY_RUN_REASON : "Open this agent's native Hermes web UI. Only one agent's UI is open at a time; opening another closes this one."}>
        {busy ? 'Opening…' : `${label} ↗`}
      </button>
      {error && <span role="alert" className="portal-error">{error}</span>}
    </span>
  );
}
