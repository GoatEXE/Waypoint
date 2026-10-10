import { useEffect, useState } from 'react';
import { api, type OrgSeat } from '../api';
import { SeatIcon } from '../components/SeatIcon';
import { HermesPortalLink } from '../components/HermesPortalLink';
import { SeatProfileEditor } from '../components/SeatProfileEditor';
import { SEAT_STATE_LABEL, seatWork } from '../seatModel';
import { useStore } from '../store';

export function SeatView({ id }: { id: string }) {
  const { state, loadBoard } = useStore();
  const [seats, setSeats] = useState<OrgSeat[] | null>(null);
  const seat = seats?.find(s => s.id === id);
  const work = seatWork(id, state.board);

  useEffect(() => {
    let active = true;
    const load = () => { void loadBoard(); api.orgSeats().then(r => { if (active) setSeats(r.seats); }).catch(() => { if (active) setSeats([]); }); };
    load();
    const timer = window.setInterval(load, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, loadBoard]);

  if (seats && !seat) return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">SEAT</div><h1 className="h1">Seat not found</h1><p className="lede">No seat is named <span className="mono">{id}</span>.</p></div>;

  return (
    <div className="page" style={{ maxWidth: 920, gap: 28 }}>
      <div className="page-head">
        <div className="eyebrow-row"><span>SEAT</span><span className="sep">·</span><span>{SEAT_STATE_LABEL[work.state].toUpperCase()}</span></div>
        <h1 className="h1 mono" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><SeatIcon id={id} description={seat?.description} size={20} />{id}</h1>
        {seat && <div className="meta-row" style={{ alignItems: 'center' }}><HermesPortalLink target={id} /></div>}
      </div>

      <SeatProfileEditor id={id} />
    </div>
  );
}
