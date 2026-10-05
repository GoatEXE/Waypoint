import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { projById, seatStatus } from '../model';
import { useStore } from '../store';
import { Dot, OnDot } from '../components/ui';
import { useSplitCols } from '../components/layout';

const TERM_COLOR = { txt: 'var(--text-3)', muted: 'var(--faint)', acc: 'var(--acc-text)', hi: 'var(--text)' } as const;

export function PodView({ name }: { name: string }) {
  const { state, set } = useStore();
  const nav = useNavigate();
  const splitCols = useSplitCols();
  const p = D.pods.find(x => x.name === name)!;
  const stopped = state.podStopped && p.name === 'web-squad-01';
  const podSeats = D.seats.filter(s => s.pod === p.name);
  const sel = podSeats.find(s => s.name === state.seat) ?? podSeats[0];
  const term: [string, keyof typeof TERM_COLOR][] = stopped
    ? [['$ pod stopped · profile snapshot saved', 'muted']]
    : D.seatTerminals[sel.name] ?? [[`$ hermes run --profile ${sel.name}`, 'txt'], ['› ' + sel.task, 'muted'], ['› idle, watching for handoffs', 'muted']];
  const secrets = sel.pod === 'api-pod-01' ? 'bw · intake-api (read)' : sel.pod === 'compliance-01' ? 'none' : 'bw · intake-web (read)';

  return (
    <div className="page" style={{ maxWidth: 1080, gap: 30 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div className="page-head">
          <div className="eyebrow">POD</div>
          <h1 className="h1 mono">{p.name}</h1>
          <div className="meta-row">
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><OnDot on={!stopped} /><span style={{ color: 'var(--text)' }}>{stopped ? 'Stopped' : 'Running'}</span></span>
            <span>Template <span className="v mono">{p.template}</span></span>
            <span>Attached to <span className="ul mono" onClick={() => nav('/projects/' + p.p)}>{projById(p.p).name}</span></span>
            <span>Up {p.uptime}</span>
          </div>
        </div>
        {p.name === 'web-squad-01' && !stopped && (
          <button className="btn lg" style={{ marginLeft: 'auto', border: '1px solid var(--border-4)', background: 'var(--surface-3)', color: 'var(--text)' }} onClick={() => nav('/pods/web-squad-01/review')}>
            Stop pod &amp; review learnings
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
        {podSeats.map(s => (
          <div key={s.name} className="row link stack" style={{ padding: 14, borderRadius: 11, border: `1px solid ${s.name === sel.name ? 'var(--border-6)' : 'var(--border)'}`, gap: 8 }} onClick={() => set({ seat: s.name })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Dot status={seatStatus(s, state.resolved, state.podStopped)} size={7} />
              <span style={{ font: '500 12.5px var(--mono)' }}>{s.name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--faint)' }}>{s.role}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)' }}>{stopped ? 'Profile saved · ' + s.task.split(' ·')[0] : s.task}</div>
          </div>
        ))}
      </div>

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 28 }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="section-head"><div className="section-title">Session</div><span className="aside">{sel.name}</span></div>
          <div className="terminal">
            {term.map(([t, c], i) => <div key={i} style={{ color: TERM_COLOR[c], whiteSpace: 'pre-wrap' }}>{t}</div>)}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fainter)' }}>›<div className="cursor" /></div>
          </div>
        </div>

        <div className="stack" style={{ gap: 22 }}>
          <div className="stack" style={{ gap: 10 }}>
            <div className="section-title">Identity</div>
            <div className="kv-grid" style={{ display: 'flex', flexDirection: 'column' }}>
              {[['Hermes profile', `~/.waypoint/profiles/${sel.name}`], ['From template', `${p.template} · ${sel.role}`], ['Secrets', secrets]].map(([k, v]) => (
                <div key={k} className="kv" style={{ padding: '10px 12px', gap: 2 }}><span className="k">{k}</span><span className="v" style={{ fontSize: 12 }}>{v}</span></div>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="section-title">Reviewed when this pod stops</div>
            <div className="stack" style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', gap: 8, fontSize: 12.5, color: 'var(--text-4)' }}>
              {[['Memory entries', '+' + p.learn.memory], ['New skills', '+' + p.learn.skills], ['Instruction changes', String(p.learn.instr)]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{k}</span><span className="mono" style={{ color: 'var(--text)' }}>{v}</span></div>
              ))}
              <div style={{ fontSize: 12, color: 'var(--faint)', paddingTop: 6, borderTop: '1px solid var(--border)' }}>Compared against each seat's starting snapshot. Open tasks and evidence are kept.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
