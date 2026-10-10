import { useState } from 'react';
import { useStore } from '../store';
import { isRuntimeOutage, rawErrorText, runtimeHealth } from '../runtimeHealth';

export function useRuntimeHealth() {
  const { state } = useStore();
  return runtimeHealth(state.runtime.status, state.runtime.error, state.runtime.checked);
}

export function StartCeoButton({ className = 'btn btn-primary sm' }: { className?: string }) {
  const { state, startCeo } = useStore();
  return <button type="button" className={className} disabled={state.runtime.starting} onClick={() => void startCeo()}>{state.runtime.starting ? 'Starting CEO…' : 'Start CEO'}</button>;
}

export function RuntimeControls({ compact = false }: { compact?: boolean }) {
  const { state, refreshRuntime } = useStore();
  const health = useRuntimeHealth();
  const [checking, setChecking] = useState(false);
  const retry = async () => { setChecking(true); await refreshRuntime(true); setChecking(false); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!compact && <span><strong>{health.message}</strong> {state.runtime.starting ? 'Starting the CEO. This can take a minute the first time.' : health.next}</span>}
        <span style={{ display: 'flex', gap: 6, marginLeft: compact ? 0 : 'auto' }}>
          {health.canStart && <StartCeoButton />}
          <button type="button" className="btn btn-ghost sm" disabled={checking || state.runtime.starting} onClick={() => void retry()}>{checking ? 'Checking…' : 'Retry'}</button>
        </span>
      </div>
      {state.runtime.startError && <div role="alert" className="form-error">{state.runtime.startError}</div>}
    </div>
  );
}

export function RuntimeBanner() {
  const { state } = useStore();
  const health = useRuntimeHealth();
  if (!isRuntimeOutage(health.cause) && !state.runtime.startError) return null;
  const raw = rawErrorText(state.runtime.error);
  return (
    <div className="runtime-banner" role="status">
      <RuntimeControls />
      {raw && <details className="runtime-details"><summary>Details</summary><code>{raw}</code></details>}
    </div>
  );
}
