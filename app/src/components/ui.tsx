import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { InboxItem, Status } from '../data';
import { ACC, st, type Group } from '../model';
import { useStore } from '../store';

export function Dot({ status, size = 8, style }: { status: Status; size?: number; style?: CSSProperties }) {
  const s = st(status);
  return <div className="dot" style={{ width: size, height: size, background: s.bg, borderColor: s.bd, ...style }} />;
}

export function OnDot({ on, size = 7, style }: { on: boolean; size?: number; style?: CSSProperties }) {
  return <div className="dot" style={{ width: size, height: size, background: on ? ACC : 'transparent', borderColor: on ? ACC : '#4a4e56', ...style }} />;
}

export function PaneGlyph({ w, h, bar, r, bw }: { w: number; h: number; bar: number; r: number; bw: number }) {
  return (
    <div className="pane-glyph" style={{ width: w, height: h, borderRadius: r, borderWidth: bw }}>
      <div style={{ width: bar, opacity: bar === 4 ? 0.8 : 1 }} />
    </div>
  );
}

export function GroupHead<T>({ g, showSub = true }: { g: Group<T>; showSub?: boolean }) {
  const nav = useNavigate();
  return (
    <div className="group-head">
      <span className="name" onClick={() => nav(g.to)}>{g.label}</span>
      {showSub && <span className="sub">{g.sub}</span>}
      <span className="count">{g.items.length}</span>
    </div>
  );
}

export function PaneGroupHead<T>({ g }: { g: Group<T> }) {
  const nav = useNavigate();
  return (
    <div className="pane-group-head">
      <span className="name" onClick={() => nav(g.to)}>{g.label}</span>
      <span className="count">{g.items.length}</span>
    </div>
  );
}

export function useInboxItem(it: InboxItem) {
  const { state, resolve } = useStore();
  const r = state.resolved[it.id];
  return {
    pending: !r,
    doneLabel: r === 'yes' ? it.yes : it.no,
    declineLabel: it.declineLabel || 'Decline',
    approve: () => resolve(it.id, 'yes'),
    decline: () => resolve(it.id, 'no'),
  };
}

export function ApprovalCard({ it, gap }: { it: InboxItem; gap: number }) {
  const a = useInboxItem(it);
  return (
    <div className="callout" style={{ padding: 14, gap }}>
      <div className="kind">{it.kind.toUpperCase()}</div>
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>{it.title}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{it.detail}</div>
      {a.pending ? (
        <div style={{ display: 'flex', gap: 8, marginTop: gap === 8 ? 2 : 0 }}>
          <button className="btn btn-primary" onClick={a.approve}>Approve</button>
          <button className="btn btn-ghost" onClick={a.decline}>Decline</button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{a.doneLabel}</div>
      )}
    </div>
  );
}

export function Page({ width, gap, bottom = 96, top = 44, children }: { width: number; gap: number; bottom?: number; top?: number; children: ReactNode }) {
  return <div className="page" style={{ maxWidth: width, gap, paddingTop: top, paddingBottom: bottom }}>{children}</div>;
}

export function WorkspaceHead({ title, lede, ledeWidth = 620 }: { title: string; lede?: string; ledeWidth?: number }) {
  return (
    <div className="page-head">
      <div className="eyebrow">WORKSPACE</div>
      <h1 className="h1">{title}</h1>
      {lede && <p className="lede" style={{ maxWidth: ledeWidth }}>{lede}</p>}
    </div>
  );
}
