import { useEffect, useState } from 'react';
import { api, type HermesStatus, type OrgSeat } from '../api';
import { OnDot, WorkspaceHead } from '../components/ui';
import { useStore } from '../store';
import { ceoNameOf } from '../orgModel';
import { ONBOARDING_KICKOFF } from './OrgSetupView';
import { HermesPortalLink } from '../components/HermesPortalLink';
import { SeatMark } from '../components/ProviderMark';
import { DRY_RUN_REASON } from '../dryRun';

export function OrgChartView() {
  const { state, setCeoThread, setPane, sendCeoMessage, openModal } = useStore();
  const [seats, setSeats] = useState<OrgSeat[] | null>(null);
  const [ceo, setCeo] = useState<HermesStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const result = await api.orgSeats(); if (active) { setSeats(result.seats); setError(''); } }
      catch (e) { if (active) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    api.hermesStatus().then(s => active && setCeo(s)).catch(() => undefined);
    const timer = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [state.modal]);

  const org = state.org.organization;
  const dryRun = Boolean(state.config?.dryRun);
  const ceoName = ceoNameOf(org);

  return (
    <div className="page" style={{ maxWidth: 1280, gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <WorkspaceHead title="Organization" />
        <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} disabled={dryRun} title={dryRun ? DRY_RUN_REASON : undefined} onClick={() => openModal('seat')}>Hire a seat</button>
        <button className="btn btn-primary" disabled={state.ceo.sending} onClick={() => { setCeoThread('general'); void sendCeoMessage(ONBOARDING_KICKOFF, true); }}>Onboard with {ceoName}</button>
      </div>
      {error && <div className="card" role="alert" style={{ padding: 12 }}>{error}</div>}
      {!seats && !error && <div className="empty" role="status">Loading organization…</div>}
      {seats && (
        <div className="org-tree">
          <div className="org-level">
            <div className="org-node org-root">
              {org?.logo ? <img className="brand-logo" src={org.logo} alt="" /> : <div className="brand-mark" />}
              <div className="stack" style={{ minWidth: 0 }}>
                <span className="org-name">{org?.name || 'Organization'}</span>
                <span className="org-sub">{seats.length} seat{seats.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
          <div className="org-stem" />
          <div className="org-level">
            <button type="button" className="org-node org-ceo" onClick={() => { setCeoThread('general'); setPane({ open: true, tab: 'ceo' }); }}>
              <div className="ceo-mark" />
              <div className="stack" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                <span className="org-name">{ceoName}</span>
                <span className="org-sub">CEO · {ceo?.model.configured ? ceo.model.default : 'model not set'}</span>
              </div>
              <span className="org-state"><OnDot on={Boolean(ceo?.runtime.running)} />{ceo ? (ceo.runtime.running ? 'running' : ceo.runtime.state) : '…'}</span>
            </button>
            {ceo?.runtime.running && <HermesPortalLink target="ceo" />}
          </div>
          {seats.length > 0 && <div className="org-stem" />}
          {seats.length === 0 && <div className="empty">No seats yet. Hire one, or ask {ceoName} to.</div>}
          <div className="org-seats org-seats-row">
            {seats.map(seat => (
              <div key={seat.id} className="org-node org-seat">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <SeatMark provider={seat.provider} size={14} />
                  <span className="org-name mono">{seat.id}</span>
                  <span className="org-sub">{seat.model}</span>
                </div>
                <span className="org-sub">{seat.description || 'No description'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
