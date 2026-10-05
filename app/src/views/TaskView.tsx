import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { ACC, projById, st, trailFor } from '../model';
import { useStore } from '../store';
import { ApprovalCard, Dot } from '../components/ui';
import { useSplitCols } from '../components/layout';

export function RunRows({ ids }: { ids: string[] }) {
  const nav = useNavigate();
  return (
    <div className="list">
      {ids.map(rid => {
        const r = D.runs[rid]; const s = st(r.st);
        return (
          <div key={rid} className="row link" style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) auto auto', gap: 16, alignItems: 'center', padding: '14px 16px' }} onClick={() => nav('/runs/' + rid)}>
            <span style={{ font: '500 12px var(--mono)', color: 'var(--text-3)' }}>{rid}</span>
            <span className="ellipsis" style={{ color: 'var(--text-4)', fontSize: 13 }}>{r.short}</span>
            <span style={{ fontSize: 12, color: s.c }}>{s.l}</span>
            <span style={{ fontSize: 12, color: 'var(--fainter)', width: 82, textAlign: 'right' }}>{r.when}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TaskView({ id }: { id: string }) {
  const { tasks, set } = useStore();
  const nav = useNavigate();
  const splitCols = useSplitCols();
  const t = tasks.find(x => x.id === id)!;
  const s = st(t.st);
  const trail = trailFor(t);
  const approval = t.approval ? D.inbox.find(i => i.id === t.approval) : undefined;
  const blockedBy = t.st === 'blocked' || t.st === 'decision' ? t.blockedBy : undefined;
  const openOwner = () => {
    const seat = D.seats.find(x => x.name === t.owner)!;
    set({ seat: seat.name });
    nav('/pods/' + seat.pod);
  };

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 32 }}>
      <div className="page-head">
        <div className="eyebrow-row"><span>TASK</span><span className="sep">·</span><span>{t.id}</span></div>
        <h1 className="h1">{t.title}</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px', fontSize: 12.5, color: 'var(--muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Dot status={t.st} /><span style={{ color: 'var(--text)' }}>{s.l}</span></span>
          <span>Owner <span className="ul mono" onClick={openOwner}>{t.owner}</span></span>
          <span>Project <span className="ul mono" onClick={() => nav('/projects/' + t.p)}>{projById(t.p).name}</span></span>
          <span className="c-fainter">{t.cost || ''}</span>
        </div>
      </div>

      <div className="stack" style={{ padding: '18px 20px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', gap: 6 }}>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>Why this matters</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-2)', maxWidth: 720, textWrap: 'pretty' }}>{t.why}</div>
      </div>

      {blockedBy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', border: '1px dashed var(--border-6)', borderRadius: 10, fontSize: 13, color: 'var(--text-3)' }}>
          <div className="dot" style={{ width: 8, height: 8, borderColor: 'var(--text)' }} />{blockedBy}
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 36 }}>
        <div className="stack" style={{ gap: 32 }}>
          <div className="stack" style={{ gap: 12 }}>
            <div className="section-title">Runs</div>
            {t.runs?.length ? <RunRows ids={t.runs} /> : <div className="empty">No runs yet.</div>}
          </div>

          <div className="stack" style={{ gap: 14 }}>
            <div className="section-title">Delegation trail</div>
            <div className="stack">
              {trail.map((x, i) => {
                const c = x.pending ? ACC : x.msg ? 'var(--faint)' : 'var(--text-3)';
                const fill = x.pending || x.msg ? 'transparent' : 'var(--text-3)';
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', gap: 12 }}>
                    <div className="stack" style={{ alignItems: 'center' }}>
                      <div style={{ width: 9, height: 9, marginTop: 5, borderRadius: x.msg ? 2 : '50%', border: `1.5px solid ${c}`, background: fill }} />
                      <div style={{ flex: 1, width: 1, background: '#24262b', margin: '4px 0', opacity: i === trail.length - 1 ? 0 : 1 }} />
                    </div>
                    <div className="stack" style={{ paddingBottom: 18, gap: 3 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline', fontSize: 12.5 }}>
                        <span className="mono c-text3">{x.from}</span>
                        <span className="c-fainter">{x.verb}</span>
                        <span className="mono c-text3">{x.to}</span>
                        <span className="c-fainter" style={{ marginLeft: 'auto' }}>{x.when}</span>
                      </div>
                      <div style={{ color: 'var(--text-4)', fontSize: 13, textWrap: 'pretty' }}>{x.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 28 }}>
          <div className="stack" style={{ gap: 10 }}>
            <div className="section-title">Depends on</div>
            {t.deps.map(depId => {
              const dt = tasks.find(x => x.id === depId)!;
              return (
                <div key={depId} className="card link" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9 }} onClick={() => nav('/tasks/' + depId)}>
                  <Dot status={dt.st} />
                  <span style={{ font: '400 12px var(--mono)', color: 'var(--faint)' }}>{depId}</span>
                  <span className="ellipsis" style={{ fontSize: 12.5 }}>{dt.title}</span>
                </div>
              );
            })}
            {!t.deps.length && <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>None</div>}
          </div>

          {approval && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="section-title">Approval</div>
              <ApprovalCard it={approval} gap={10} />
            </div>
          )}

          <div className="stack" style={{ gap: 10 }}>
            <div className="section-title">Messages</div>
            {(t.msgs || []).map((m, i) => (
              <div key={i} className="stack" style={{ gap: 4, padding: '10px 12px', borderLeft: '2px solid #24262b' }}>
                <div style={{ font: '400 11.5px var(--mono)', color: 'var(--dim)' }}>{m.from} → {m.to}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{m.text}</div>
              </div>
            ))}
            {!t.msgs?.length && <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>No seat-to-seat messages.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
