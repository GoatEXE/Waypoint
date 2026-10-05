import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { projById, projStats, seatStatus, st } from '../model';
import { useStore } from '../store';
import { Dot, OnDot, PaneGlyph } from '../components/ui';
import { useSplitCols } from '../components/layout';

export function ProjectView({ id }: { id: D.ProjectId }) {
  const { state, tasks, setPane } = useStore();
  const nav = useNavigate();
  const splitCols = useSplitCols();
  const p = projById(id);
  const s = projStats(p, tasks);
  const pod = D.pods.find(x => x.name === p.pod)!;

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 36 }}>
      <div className="page-head">
        <div className="eyebrow">PROJECT</div>
        <h1 className="h1 mono">{p.name}</h1>
        <p className="lede" style={{ fontSize: 15, maxWidth: 'none' }}>{p.goal}</p>
        <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>Advances <span className="ul" onClick={() => nav('/')}>{D.mission.title}</span></div>
      </div>

      <div className="kv-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        {[['Repository', p.repo], ['Branch', p.branch], ['Environment', p.env]].map(([k, v]) => (
          <div key={k} className="kv" style={{ padding: '14px 16px', gap: 4 }}><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
        <div className="kv" style={{ padding: '14px 16px', gap: 4 }}>
          <div className="k">Progress</div>
          <div style={{ fontSize: 12.5 }}>{s.done} of {s.total} done · <span style={{ color: 'var(--muted)' }}>{p.lastDone}</span></div>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 32 }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="section-title">Tasks</div>
          <div className="list">
            {s.ts.map(t => {
              const ts = st(t.st);
              return (
                <div key={t.id} className="row link task-row" onClick={() => nav('/tasks/' + t.id)}>
                  <Dot status={t.st} size={9} />
                  <span className="id">{t.id}</span>
                  <span className="ellipsis" style={{ flex: 1 }}>{t.title}</span>
                  <span style={{ fontSize: 12, color: ts.c, whiteSpace: 'nowrap' }}>{ts.l}</span>
                  <span style={{ font: '400 12px var(--mono)', color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{t.owner}</span>
                  <button
                    className="pin-btn"
                    title="Open in side pane"
                    onClick={e => { e.stopPropagation(); setPane({ open: true, tab: 'item', item: t.id }); }}
                  >
                    <PaneGlyph w={11} h={9} bar={3} r={2} bw={1.3} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <div className="section-title">Assigned pod</div>
          <div className="card link stack" style={{ padding: 16, gap: 12 }} onClick={() => nav('/pods/' + pod.name)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <OnDot on={!(state.podStopped && pod.name === 'web-squad-01')} />
              <span style={{ font: '500 13px var(--mono)' }}>{pod.name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--faint)' }}>{pod.template}</span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {D.seats.filter(x => x.pod === pod.name).map(x => (
                <div key={x.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <Dot status={seatStatus(x, state.resolved, state.podStopped)} size={6} />
                  <span className="mono c-text3" style={{ fontSize: 12 }}>{x.name}</span>
                  <span className="ellipsis" style={{ marginLeft: 'auto', color: 'var(--faint)', fontSize: 12 }}>{x.task}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
