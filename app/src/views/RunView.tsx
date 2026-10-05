import { useState } from 'react';
import * as D from '../data';
import { ACC, st } from '../model';
import { Dot } from '../components/ui';

export function RunView({ id }: { id: string }) {
  const r = D.runs[id];
  const t = D.tasks.find(x => x.id === r.task)!;
  const s = st(r.st);
  const passed = r.st === 'passed';
  const [openFiles, setOpenFiles] = useState<Record<number, boolean>>({ 0: true });
  const add = r.files.reduce((a, f) => a + f.add, 0);
  const del = r.files.reduce((a, f) => a + f.del, 0);
  const artifacts = [{ kind: 'storybook', name: 'Steps/InsuranceCard' }, { kind: 'report', name: `vitest-${id}.json` }];

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 30 }}>
      <div className="page-head">
        <div className="eyebrow-row"><span>RUN</span><span className="sep">·</span><span>{id}</span><span className="sep">·</span><span>{t.id}</span></div>
        <h1 className="h1">{t.title}</h1>
        <div className="meta-row">
          <span>Seat <span className="v mono">{r.seat}</span></span>
          <span>Worktree <span className="v mono">{r.worktree}</span></span>
          <span>{r.when}</span>
          <span>{r.dur}</span>
          <span className="c-fainter">{r.tokens} tokens · {r.cost}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '16px 18px', borderRadius: 12, border: `1px solid ${passed ? 'var(--acc-line)' : 'var(--border-3)'}`, background: passed ? 'var(--acc-wash)' : 'var(--surface-2)' }}>
        <Dot status={r.st} size={9} style={{ marginTop: 6 }} />
        <div className="stack" style={{ gap: 3 }}>
          <div style={{ fontWeight: 500 }}>{s.l}</div>
          <div style={{ color: 'var(--text-3)', fontSize: 13.5, textWrap: 'pretty' }}>{r.reason}</div>
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="section-title">Agent summary</div>
        <div style={{ color: 'var(--text-3)', fontSize: 14, lineHeight: 1.6, maxWidth: 760, textWrap: 'pretty' }}>{r.summary}</div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="section-head">
          <div className="section-title">Changed files</div>
          <span className="aside">{r.files.length ? `${r.files.length} files · +${add} −${del}` : 'no changes kept'}</span>
        </div>
        <div className="diff-list">
          {r.files.map((f, i) => {
            const open = !!openFiles[i];
            return [
              <div key={'f' + i} className={'file-row' + (open ? ' open' : '')} onClick={() => setOpenFiles(o => ({ ...o, [i]: !o[i] }))}>
                <span style={{ font: '400 11px var(--mono)', color: 'var(--fainter)', width: 10 }}>{open ? '▾' : '▸'}</span>
                <span className="ellipsis" style={{ font: '400 12.5px var(--mono)', flex: 1 }}>{f.path}</span>
                <span style={{ font: '400 12px var(--mono)', color: 'var(--text-3)' }}>+{f.add}</span>
                <span style={{ font: '400 12px var(--mono)', color: 'var(--faint)' }}>−{f.del}</span>
              </div>,
              open && (
                <div key={'d' + i} className="diff">
                  {f.lines.map(([n, m, tx], j) => (
                    <div key={j} className="diff-line" style={{ background: m === '+' ? 'oklch(0.72 0.14 252 / .08)' : m === '-' ? 'rgba(255,255,255,.03)' : 'transparent', color: m === '-' ? 'var(--faint)' : 'var(--text-3)' }}>
                      <span className="n">{n}</span>
                      <span className="m" style={{ color: m === '+' ? ACC : 'var(--faint)' }}>{m === ' ' ? '' : m}</span>
                      <span>{tx}</span>
                    </div>
                  ))}
                </div>
              ),
            ];
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 28, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="section-head">
            <div className="section-title">Tests</div>
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>{r.testSum}</span>
          </div>
          <div className="list">
            {r.tests.map(([m, name, ms], i) => (
              <div key={i} className="row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', fontSize: 12.5 }}>
                <span style={{ font: '500 12px var(--mono)', width: 12, color: m === '✓' ? ACC : 'var(--text)' }}>{m}</span>
                <span className="ellipsis c-text3" style={{ flex: 1 }}>{name}</span>
                <span style={{ font: '400 11.5px var(--mono)', color: 'var(--fainter)' }}>{ms}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <div className="section-title">Artifacts</div>
          <div className="hatch" style={{ aspectRatio: '16/9', border: '1px solid var(--border)', borderRadius: 12, fontSize: 11.5, background: 'repeating-linear-gradient(135deg,#121316 0 10px,#15171a 10px 20px)' }}>
            screenshot · insurance-step-mobile.png
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {artifacts.map(a => (
              <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                <span style={{ font: '400 11px var(--mono)', color: 'var(--faint)', width: 62 }}>{a.kind}</span>
                <span className="mono c-text3" style={{ fontSize: 12 }}>{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
