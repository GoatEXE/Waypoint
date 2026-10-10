import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type OrgSeat } from '../api';
import { useStore } from '../store';
import { SeatMark } from './ProviderMark';

export function PodDialog() {
  const { closeModal, flash, loadPods } = useStore();
  const nav = useNavigate();
  const [seats, setSeats] = useState<OrgSeat[] | null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [durable, setDurable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.orgSeats().then(r => setSeats(r.seats)).catch(() => setSeats([])); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, closeModal]);

  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const ready = /^[a-z][a-z0-9-]{1,14}$/.test(name) && picked.length > 0;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const pod = await api.createPod({ name, purpose: purpose.trim(), seats: picked, durable });
      await loadPods();
      closeModal();
      flash(`Started pod ${pod.name}`);
      nav('/pods/' + pod.name);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) closeModal(); }}>
      <form className="modal" style={{ padding: 22, gap: 16 }} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">NEW POD</div>
          <h2 className="h1" style={{ fontSize: 20 }}>Start a pod</h2>
        </div>
        <label className="field"><span className="field-label">Name</span>
          <input className="input mono" value={name} maxLength={15} disabled={busy} placeholder="web" onChange={e => setName(e.target.value.toLowerCase())} />
          <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Its board is pod-{name || 'name'}; its seats are {name || 'name'}-seat.</span>
        </label>
        <label className="field"><span className="field-label">Purpose</span>
          <input className="input" value={purpose} maxLength={300} disabled={busy} placeholder="What this pod is for" onChange={e => setPurpose(e.target.value)} />
        </label>
        <div className="field"><span className="field-label">Seats (each is cloned into the pod)</span>
          {seats === null ? <span style={{ fontSize: 12, color: 'var(--faint)' }}>Loading seats…</span>
            : seats.length ? <div className="chips">{seats.map(seat => (
              <button key={seat.id} type="button" className={'chip mono' + (picked.includes(seat.id) ? ' on' : '')} aria-pressed={picked.includes(seat.id)} disabled={busy} title={seat.description} onClick={() => toggle(seat.id)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><SeatMark provider={seat.provider} size={12} />{seat.id}</span>
              </button>
            ))}</div>
            : <span style={{ fontSize: 12, color: 'var(--faint)' }}>Hire a seat first.</span>}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={durable} disabled={busy} onChange={e => setDurable(e.target.checked)} />
          Durable (keep it after its work is done)
        </label>
        {error && <div role="alert" className="form-error">{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={closeModal}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !ready}>{busy ? 'Starting…' : 'Start pod'}</button>
        </div>
      </form>
    </div>
  );
}
