import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import type { LessonPick } from '../data';
import { ACC } from '../model';
import { useStore } from '../store';

const OPTS: [LessonPick, string][] = [['seat', 'Keep with seat'], ['project', 'Add to project'], ['template', 'Propose for template'], ['discard', 'Discard']];

export function ReviewView() {
  const { state, set } = useStore();
  const nav = useNavigate();
  const pickOf = (l: D.Lesson) => state.picks[l.id] || l.sug;
  const cnt = (k: LessonPick) => D.lessons.filter(l => pickOf(l) === k).length;

  const apply = () => {
    set(s => ({ podStopped: true, resolved: { ...s.resolved, 'learn-web': 'yes' } }));
    nav('/pods/web-squad-01');
  };

  return (
    <div className="page" style={{ maxWidth: 960, gap: 28, paddingBottom: 120 }}>
      <div className="page-head">
        <div className="eyebrow">LEARNING REVIEW · WEB-SQUAD-01</div>
        <h1 className="h1">What this pod learned</h1>
        <p className="lede" style={{ maxWidth: 640 }}>Each change is diffed against the seat's starting snapshot. Choose where it should live. Promotions are versioned and reversible; originals are kept.</p>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {D.lessons.map(l => {
          const pick = pickOf(l);
          const hint = { seat: `Stays in ${l.seat}'s Hermes profile`, project: 'Becomes project knowledge for intake-web', template: 'Drafted into web-squad v4 for review', discard: 'Dropped; original snapshot kept' }[pick];
          return (
            <div key={l.id} className="card stack" style={{ padding: '16px 18px', gap: 12, opacity: pick === 'discard' ? 0.6 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--dim)' }}>
                <span className="mono c-text3">{l.seat}</span>
                <span style={{ padding: '1px 7px', border: '1px solid var(--border-3)', borderRadius: 5 }}>{l.kind}</span>
                <span>evidence <span className="mono" style={{ color: 'var(--text-4)' }}>{l.ev}</span></span>
                {l.flag && (
                  <span style={{ marginLeft: 'auto', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="dot" style={{ width: 7, height: 7, borderColor: 'var(--text)' }} />{l.flag}
                  </span>
                )}
              </div>
              <div style={{ font: '400 13px/1.6 var(--mono)', color: 'var(--text)', padding: '10px 12px', background: 'var(--well)', borderRadius: 8, borderLeft: `2px solid ${pick === 'discard' ? 'var(--border-3)' : ACC}` }}>
                <span className="c-faint">+ </span>{l.text}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div className="segmented" role="radiogroup">
                  {OPTS.map(([k, label]) => (
                    <button key={k} role="radio" aria-checked={pick === k} className={pick === k ? 'on' : ''} onClick={() => set(s => ({ picks: { ...s.picks, [l.id]: k } }))}>{label}</button>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: 'var(--faint)' }}>{hint}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="review-bar">
        <span style={{ fontSize: 13, color: 'var(--text-4)' }}>
          {cnt('project')} to project · {cnt('template')} to template · {cnt('seat')} kept with seat · {cnt('discard')} discarded
        </span>
        <button className="btn lg btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => nav('/pods/web-squad-01')}>Keep pod running</button>
        <button className="btn lg btn-primary" onClick={apply}>Apply &amp; stop pod</button>
      </div>
    </div>
  );
}
