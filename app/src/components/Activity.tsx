import { useState } from 'react';
import type { ActivityItem } from '../api';

function activityGlyph(status: ActivityItem['status']) {
  if (status === 'running') return <span className="act-glyph running" aria-label="running" />;
  if (status === 'ok') return <span className="act-glyph ok" aria-label="done">✓</span>;
  if (status === 'error') return <span className="act-glyph err" aria-label="failed">✕</span>;
  return <span className="act-glyph" aria-label="unknown">?</span>;
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <div className="act-list">
      {items.map((item, i) => (
        <div key={i} className={'act-item' + (item.kind === 'action' ? ' action' : '')} title={item.detail}>
          {activityGlyph(item.status)}
          <span className="act-name">{item.kind === 'action' ? item.name.replaceAll('_', ' ') : item.name}</span>
          <span className="act-detail">{item.detail}</span>
          {item.durationMs != null && <span className="act-time">{item.durationMs < 1000 ? `${item.durationMs}ms` : `${(item.durationMs / 1000).toFixed(1)}s`}</span>}
        </div>
      ))}
    </div>
  );
}

export function ActivityBlock({ items }: { items: ActivityItem[] }) {
  const [open, setOpen] = useState(false);
  const tools = items.filter(i => i.kind === 'tool').length;
  const actions = items.length - tools;
  const failed = items.filter(i => i.status === 'error').length;
  const parts = [tools && `${tools} tool call${tools === 1 ? '' : 's'}`, actions && `${actions} Waypoint action${actions === 1 ? '' : 's'}`, failed && `${failed} failed`].filter(Boolean);
  return (
    <div className="act-block">
      <button type="button" className="act-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span style={{ transform: `rotate(${open ? 90 : 0}deg)`, display: 'inline-block' }}>▸</span> {parts.join(' · ')}
      </button>
      {open && <ActivityList items={items} />}
    </div>
  );
}
