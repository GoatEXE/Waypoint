import { useState } from 'react';
import { api, type LearningItem, type Pod } from '../api';
import { useStore } from '../store';

function Item({ pod, item, onChange }: { pod: Pod; item: LearningItem; onChange: (pod: Pod) => void }) {
  const { flash } = useStore();
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'apply' | 'drop') => {
    setBusy(true);
    try { onChange(await api.decideLearning(pod.name, item.id, decision)); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  const label = item.kind === 'memory' ? `New memory (${item.path})` : `${item.change === 'added' ? 'New' : 'Changed'} skill ${item.path}`;
  return (
    <div className="stack" style={{ gap: 8, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12.5 }}>
        <strong style={{ fontWeight: 500 }}>{label}</strong>
        <span style={{ color: 'var(--muted)' }}>from <span className="mono">{item.seat}</span></span>
        {item.decision && <span className="task-pill" style={{ marginLeft: 'auto' }}>{item.decision === 'apply' ? `added to ${item.from}` : 'dropped'}</span>}
      </div>
      <div className="inbox-handoff">{item.text || '(empty)'}</div>
      {!item.decision && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost sm" disabled={busy} onClick={() => void decide('drop')}>Drop</button>
        <button className="btn btn-primary sm" disabled={busy} onClick={() => void decide('apply')}>Add to {item.from}</button>
      </div>}
    </div>
  );
}

export function PodLearning({ pod, onChange }: { pod: Pod; onChange: (pod: Pod) => void }) {
  const { flash, loadPods } = useStore();
  const [busy, setBusy] = useState(false);
  const items = pod.learning?.items || [];
  const pending = items.filter(item => !item.decision).length;
  const update = async (next: Pod) => { onChange(next); await loadPods(); };
  const review = async () => {
    setBusy(true);
    try { await update(await api.reviewLearning(pod.name)); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (pod.seatsRemoved) return <section className="stack" style={{ gap: 8 }}><div className="section-title">Learning</div><div className="empty">Reviewed. The pod's seat clones were removed.</div></section>;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="section-title">Learning {pending > 0 && <span className="task-count">{pending}</span>}</div>
        {pod.status === 'active' && <button className="btn btn-ghost sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void review()}>{busy ? 'Checking…' : 'Review learning'}</button>}
      </div>
      {!pod.learning && <div className="empty">{pod.status === 'active' ? 'What the pod\'s seats learn is reviewed when the pod closes, or now with Review learning.' : 'Not reviewed yet.'}</div>}
      {pod.learning && !items.length && <div className="empty">Nothing new to bring back to the original seats.</div>}
      {pending > 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Choose what each original seat should keep. {pod.status === 'closed' && !pod.durable ? 'The pod\'s seat clones are removed once every item is decided.' : ''}</div>}
      {items.map(item => <Item key={item.id} pod={pod} item={item} onChange={next => void update(next)} />)}
    </section>
  );
}
