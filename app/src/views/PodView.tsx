import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isNotFoundError, type PodInstance, type PodInstanceSeat } from '../api';
import { podStateLabel, shortDate } from '../missionsModel';
import { OnDot } from '../components/ui';
import { useSplitCols } from '../components/layout';
import { PodSeatSetup } from './PodSeatSetup';
import { HermesPortalLink } from '../components/HermesPortalLink';

type LoadState =
  | { status: 'loading'; pod: null; error: null }
  | { status: 'ready'; pod: PodInstance; error: null }
  | { status: 'notfound'; pod: null; error: null }
  | { status: 'error'; pod: null; error: string };

const initialLoad: LoadState = { status: 'loading', pod: null, error: null };

function StatePill({ state }: { state: string }) {
  return <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><OnDot on={state === 'running'} /><span style={{ color: 'var(--text)' }}>{podStateLabel(state)}</span></span>;
}

function seatLabel(seat: PodInstanceSeat): string {
  return seat.state ? seat.state.charAt(0).toUpperCase() + seat.state.slice(1) : 'Recorded';
}

function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return <button className="btn lg btn-ghost" onClick={onClick} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>;
}

function podStatusSentence(state: string): string {
  if (state === 'planned') return 'This pod is set up but not running. Start it, prepare a seat, and connect its provider before running tasks.';
  if (state === 'running') return 'This pod is running.';
  if (state === 'stopped') return 'This pod is stopped.';
  if (state === 'missing') return 'This pod is not available right now.';
  return `Current state: ${podStateLabel(state)}.`;
}

export function PodView({ name }: { name: string }) {
  const podId = name;
  const nav = useNavigate();
  const splitCols = useSplitCols();
  const [load, setLoad] = useState<LoadState>(initialLoad);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState('');

  const loadPod = useCallback(async (mode: 'initial' | 'refresh' | 'quiet' = 'initial') => {
    if (mode === 'initial') setLoad(initialLoad);
    else if (mode === 'refresh') setRefreshing(true);
    try {
      const pod = await api.podInstance(podId);
      setLoad({ status: 'ready', pod, error: null });
      setSelectedSeat(current => pod.seats.some(s => s.id === current) ? current : pod.seats[0]?.id || '');
    } catch (error) {
      if (isNotFoundError(error)) setLoad({ status: 'notfound', pod: null, error: null });
      else setLoad({ status: 'error', pod: null, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRefreshing(false);
    }
  }, [podId]);

  useEffect(() => { void loadPod(); }, [loadPod]);

  if (load.status === 'loading') {
    return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">POD</div><h1 className="h1 mono">{podId}</h1><p className="lede" role="status">Loading pod record…</p></div>;
  }

  if (load.status === 'notfound') {
    return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">NOT FOUND</div><h1 className="h1">Pod not found</h1><p className="lede">No stored pod instance exists for <span className="mono">{podId}</span>.</p><RefreshButton loading={refreshing} onClick={() => void loadPod('refresh')} /></div>;
  }

  if (load.status === 'error') {
    return <div className="page" style={{ maxWidth: 920, gap: 14 }}><div className="eyebrow">POD</div><h1 className="h1">Couldn't load this pod</h1><p className="lede" role="alert">The Waypoint service did not answer: {load.error}</p><RefreshButton loading={refreshing} onClick={() => void loadPod('refresh')} /></div>;
  }

  const pod = load.pod;
  const selected = pod.seats.find(s => s.id === selectedSeat) || pod.seats[0];
  const lifecycle = pod.lifecycle;

  return (
    <div className="page" style={{ maxWidth: 1080, gap: 30 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div className="page-head">
          <div className="eyebrow">POD</div>
          <h1 className="h1 mono">{pod.podName || pod.id}</h1>
          <div className="meta-row">
            <StatePill state={pod.state} />
            <span>Pod ID <span className="v mono">{pod.id}</span></span>
            <span>Template <span className="v mono">{pod.templateId}{pod.templateVersion ? ` · ${pod.templateVersion}` : ''}</span></span>
            {pod.createdAt && <span>Recorded <span className="v">{shortDate(pod.createdAt)}</span></span>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}><RefreshButton loading={refreshing} onClick={() => void loadPod('refresh')} /></div>
      </div>

      <div className="stack" style={{ padding: '16px 18px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', gap: 6 }}>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Status</div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {podStatusSentence(pod.state)}
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 28 }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="section-head"><div className="section-title">Seats</div><span className="aside">{pod.seats.length}</span></div>
          {!pod.seats.length && <div className="empty">No seats are recorded for this pod.</div>}
          {!!pod.seats.length && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
              {pod.seats.map(seat => (
                <button key={seat.id} className="row stack" style={{ textAlign: 'left', padding: 14, borderRadius: 11, border: `1px solid ${selected?.id === seat.id ? 'var(--border-6)' : 'var(--border)'}`, gap: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }} onClick={() => setSelectedSeat(seat.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <OnDot on={pod.state === 'running'} />
                    <span style={{ font: '500 12.5px var(--mono)' }}>{seat.id}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--faint)' }}>{seat.role}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-4)' }}>{seatLabel(seat)}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 22 }}>
          <div className="stack" style={{ gap: 10 }}>
            <div className="section-title">Selected seat</div>
            {selected ? (
              <div className="kv-grid" style={{ display: 'flex', flexDirection: 'column' }}>
                {[
                  ['Seat ID', selected.id],
                  ['Role', selected.role],
                  ['Seat record', seatLabel(selected)],
                  ['Baseline files copied', String(selected.copiedFiles?.length || 0)],
                ].map(([k, v]) => (
                  <div key={k} className="kv" style={{ padding: '10px 12px', gap: 2 }}><span className="k">{k}</span><span className="v" style={{ fontSize: 12 }}>{v}</span></div>
                ))}
              </div>
            ) : <div className="empty">No seat selected.</div>}
            {selected && pod.state === 'running' && <div><HermesPortalLink target={`${pod.id}/${selected.id}`} label="Open Hermes UI" /></div>}
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <div className="section-title">Lifecycle note</div>
            <div className="stack" style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', gap: 8, fontSize: 12.5, color: 'var(--text-4)' }}>
              {lifecycle?.updatedAt ? (
                <>
                  <div>Last recorded action: <span className="mono c-text3">{lifecycle.lastAction || 'status'}</span></div>
                  <div>Updated {shortDate(lifecycle.updatedAt)}. {lifecycle.dryRun ? 'Planning check only; the pod was not changed.' : lifecycle.executed ? 'The action was completed.' : 'No action was performed.'}</div>
                </>
              ) : <div className="empty">No lifecycle action is recorded.</div>}
            </div>
          </div>

          <PodSeatSetup pod={pod} selectedSeatId={selected?.id || ''} onPodChanged={() => loadPod('quiet')} />

          <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', padding: '7px 12px', color: 'var(--text)' }} onClick={() => nav('/')}>Back to mission</button>
        </div>
      </div>
    </div>
  );
}
