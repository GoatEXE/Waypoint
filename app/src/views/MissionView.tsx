import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { ACC, missionPct, projStats } from '../model';
import { useStore } from '../store';

export function MissionView() {
  const { tasks, pending } = useStore();
  const nav = useNavigate();
  const pct = missionPct(tasks);
  const needs = pending.slice(0, 3);

  return (
    <div className="page" style={{ maxWidth: 920, paddingTop: 48, gap: 44 }}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="eyebrow">MISSION</div>
        <h1 className="mission-h1">{D.mission.title}</h1>
        <p className="mission-lede">{D.mission.outcome}</p>
        <div className="meta-row" style={{ gap: '8px 22px', marginTop: 4 }}>
          <span>Target <span className="v">{D.mission.target}</span></span>
          <span><span className="v">{tasks.filter(t => t.st === 'done').length} of {tasks.length}</span> tasks done</span>
          <span><span className="v">{D.projects.length}</span> projects</span>
          <span>Assigned to <span className="v mono" style={{ fontSize: 12 }}>{D.mission.assignedTo}</span> · {D.mission.assignedOn}</span>
        </div>
        <div className="bar" style={{ background: '#1c1e22', marginTop: 6 }}><div style={{ width: pct + '%', background: ACC }} /></div>
      </div>

      {needs.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div className="section-title">Needs you</div>
            <span className="crumb-link" style={{ fontSize: 12.5 }} onClick={() => nav('/inbox')}>Open inbox →</span>
          </div>
          <div className="needs-grid">
            {needs.map(n => (
              <div key={n.id} className="need" onClick={() => nav(n.review ? '/pods/web-squad-01/review' : '/inbox')}>
                <div className="kind">{n.kind.toUpperCase()}</div>
                <div className="title">{n.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 12 }}>
        <div className="section-title">Projects advancing this mission</div>
        <div className="list">
          {D.projects.map(p => {
            const s = projStats(p, tasks);
            return (
              <div key={p.id} className="row link proj-row" onClick={() => nav('/projects/' + p.id)}>
                <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                  <div style={{ font: '500 13.5px var(--mono)' }}>{p.name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>{p.goal}</div>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--dim)' }}>
                    <span>{s.done} of {s.total} done</span><span className="mono">{s.pct}%</span>
                  </div>
                  <div className="bar" style={{ background: 'var(--border)' }}><div style={{ width: s.pct + '%', background: 'var(--text-3)' }} /></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                  <span>{s.flag}</span>
                  <span style={{ color: 'var(--quiet)' }}>→</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
