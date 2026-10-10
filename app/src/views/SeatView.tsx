import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type BoardEvent, type OrgSeat } from '../api';
import { SeatIcon } from '../components/SeatIcon';
import { HermesPortalLink } from '../components/HermesPortalLink';
import { SEAT_STATE_LABEL, seatWork } from '../seatModel';
import { statusLabel, taskLabel } from '../taskQueueModel';
import { useStore } from '../store';

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function SeatView({ id }: { id: string }) {
  const nav = useNavigate();
  const { state, loadBoard } = useStore();
  const [seats, setSeats] = useState<OrgSeat[] | null>(null);
  const [events, setEvents] = useState<BoardEvent[]>([]);
  const seat = seats?.find(s => s.id === id);
  const work = seatWork(id, state.board);
  const currentRef = work.current ? taskLabel(work.current) : null;
  const currentKey = JSON.stringify(work.current);

  useEffect(() => {
    let active = true;
    const load = () => { void loadBoard(); api.orgSeats().then(r => { if (active) setSeats(r.seats); }).catch(() => { if (active) setSeats([]); }); };
    load();
    const timer = window.setInterval(load, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, loadBoard]);
  useEffect(() => {
    if (!currentRef) { setEvents([]); return; }
    api.task(currentRef).then(t => setEvents(t.events.filter(e => e.kind !== 'heartbeat').slice(-8).reverse())).catch(() => setEvents([]));
  }, [currentRef, currentKey]);

  if (seats && !seat) return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">SEAT</div><h1 className="h1">Seat not found</h1><p className="lede">No seat is named <span className="mono">{id}</span>.</p></div>;

  return (
    <div className="page" style={{ maxWidth: 920, gap: 28 }}>
      <div className="page-head">
        <div className="eyebrow-row"><span>SEAT</span><span className="sep">·</span><span>{SEAT_STATE_LABEL[work.state].toUpperCase()}</span></div>
        <h1 className="h1 mono" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><SeatIcon id={id} description={seat?.description} size={20} />{id}</h1>
        <p className="lede">{seat ? seat.description || 'No description' : 'Loading seat…'}</p>
        {seat && <div className="meta-row" style={{ alignItems: 'center' }}>{seat.model && <span>Model <span className="v">{seat.model}</span></span>}<HermesPortalLink target={id} /></div>}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="section-title">Now</div>
        {work.current ? (
          <div className="list">
            <div className="row link" style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '14px 16px' }} onClick={() => nav('/tasks/' + encodeURIComponent(currentRef!))}>
              <span className="task-ref">{currentRef}</span>
              <span className="ellipsis" style={{ flex: 1 }}>{work.current.title}</span>
              <span className="task-pill">{statusLabel(work.current.status)}</span>
              <span style={{ color: 'var(--quiet)' }}>→</span>
            </div>
          </div>
        ) : <div className="empty">Idle. Nothing assigned is open.</div>}
        {events.length > 0 && (
          <ul className="status-history" aria-label="Recent events">
            {events.map((e, i) => <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--faint)', padding: '3px 10px' }}><span>{e.kind.replaceAll('_', ' ')}{e.detail ? `: ${e.detail}` : ''}</span><span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{formatDateTime(e.at)}</span></li>)}
          </ul>
        )}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="section-title">Recent tasks</div>
        {!work.recent.length && <div className="empty">No tasks yet.</div>}
        {work.recent.length > 0 && <div className="list">
          {work.recent.map(t => (
            <div key={t.id} className="row link" style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '10px 16px' }} onClick={() => nav('/tasks/' + encodeURIComponent(taskLabel(t)))}>
              <span className="task-ref">{taskLabel(t)}</span>
              <span className="ellipsis" style={{ flex: 1 }}>{t.title}</span>
              <span className="task-pill">{statusLabel(t.status)}</span>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
