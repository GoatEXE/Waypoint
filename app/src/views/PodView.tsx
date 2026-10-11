import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isNotFoundError, type BoardTask, type Pod, type PodEntry } from '../api';
import { TaskRefText } from '../components/TaskRefText';
import { PodLearning } from '../components/PodLearning';
import { useSplitCols } from '../components/layout';
import { statusLabel, taskLabel } from '../taskQueueModel';
import { useStore } from '../store';
import { NewTaskDialog } from './TasksView';

const ENTRY_VERB: Record<PodEntry['kind'], string> = { task: 'asked', comment: 'commented', review_requested: 'handed in', completed: 'finished', blocked: 'is blocked' };

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Entry({ entry }: { entry: PodEntry }) {
  const nav = useNavigate();
  return (
    <div className="stack" style={{ gap: 6, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: entry.kind === 'task' ? 'var(--surface-2)' : 'var(--surface)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12 }}>
        <span className="mono" style={{ color: 'var(--text)' }}>{entry.author || 'someone'}</span>
        <span style={{ color: 'var(--muted)' }}>{ENTRY_VERB[entry.kind]}{entry.kind === 'task' && entry.to ? <> <span className="mono" style={{ color: 'var(--text)' }}>{entry.to}</span></> : null}</span>
        {entry.ref && <button type="button" className="ref-link" onClick={() => nav('/tasks/' + encodeURIComponent(entry.ref!))}>{entry.ref}</button>}
        <span className="ellipsis" style={{ color: 'var(--faint)', flex: 1, minWidth: 0 }}>{entry.title}</span>
        <span style={{ color: 'var(--faint)' }}>{formatTime(entry.at)}</span>
      </div>
      {entry.text && <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)', maxHeight: 220, overflow: 'auto' }}><TaskRefText text={entry.text} /></div>}
    </div>
  );
}

export function PodView({ name }: { name: string }) {
  const nav = useNavigate();
  const splitCols = useSplitCols();
  const { state, flash, loadPods, loadBoard } = useStore();
  const [pod, setPod] = useState<(Pod & { tasks: BoardTask[] }) | null>(null);
  const [entries, setEntries] = useState<PodEntry[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, conversation] = await Promise.all([api.pod(name), api.podConversation(name)]);
      setPod(detail); setEntries(conversation.entries); setError('');
    } catch (e) { setError(isNotFoundError(e) ? 'notfound' : e instanceof Error ? e.message : String(e)); }
  }, [name]);
  const boardKey = JSON.stringify(state.board.filter(t => t.board === `pod-${name}`));
  useEffect(() => { void load(); }, [load, boardKey]);

  if (error === 'notfound') return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">POD</div><h1 className="h1">Pod not found</h1><p className="lede">No pod is named <span className="mono">{name}</span>.</p></div>;
  if (error) return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">POD</div><h1 className="h1">Couldn't load this pod</h1><p className="lede" role="alert">{error}</p></div>;
  if (!pod) return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">POD</div><h1 className="h1 mono">{name}</h1><p className="lede" role="status">Loading pod…</p></div>;

  const active = pod.status === 'active';
  const close = async () => {
    setBusy(true);
    try { await api.closePod(pod.name); await Promise.all([loadPods(), loadBoard(), load()]); flash(`Closed pod ${pod.name}`); setConfirmClose(false); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page" style={{ maxWidth: 1100, gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div className="page-head">
          <div className="eyebrow-row"><span>POD</span><span className="sep">·</span><span>{pod.durable ? 'DURABLE' : 'TEMPORARY'}</span><span className="sep">·</span><span>{active ? 'ACTIVE' : 'CLOSED'}</span></div>
          <h1 className="h1 mono">{pod.name}</h1>
          {pod.purpose && <p className="lede" style={{ margin: 0 }}>{pod.purpose}</p>}
        </div>
        {active && <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="btn lg btn-ghost" disabled={busy} onClick={() => setConfirmClose(true)}>Close pod</button>
          <button className="btn lg btn-primary" onClick={() => setCreating(true)}>New task</button>
        </div>}
      </div>
      {confirmClose && (
        <div className="stack" style={{ gap: 10, padding: 16, border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
          <strong>Close pod {pod.name}?</strong>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Its board is archived, so nothing more runs in it. Then you choose what its seats learned to bring back to the original seats.</span>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmClose(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void close()}>{busy ? 'Closing…' : 'Close pod'}</button>
          </div>
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 36 }}>
        <div className="stack" style={{ gap: 28 }}>
        <PodLearning pod={pod} onChange={next => setPod(current => (current ? { ...current, ...next } : current))} />
        <section className="stack" style={{ gap: 10 }}>
          <div className="section-title">Conversation</div>
          {entries === null && <div className="empty" role="status">Loading…</div>}
          {entries?.length === 0 && <div className="empty">{active ? 'No work yet. Give the pod a task, and the seats talk through it here.' : 'This pod is closed.'}</div>}
          {entries?.map((entry, i) => <Entry key={i} entry={entry} />)}
        </section>
        </div>

        <div className="stack" style={{ gap: 24 }}>
          <section className="stack" style={{ gap: 8 }}>
            <div className="section-title">Roster</div>
            {pod.seats.map(seat => (
              <div key={seat.id} className="stack" style={{ gap: 2, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--text)' }}>{seat.id}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{seat.description || seat.from}</span>
                <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>cloned from {seat.from}</span>
              </div>
            ))}
          </section>
          <section className="stack" style={{ gap: 8 }}>
            <div className="section-title">Tasks</div>
            {!pod.tasks.length && <div className="empty">No tasks.</div>}
            {pod.tasks.map(task => (
              <button key={task.id} type="button" className="task-row" style={{ borderRadius: 8, border: '1px solid var(--border)' }} onClick={() => nav('/tasks/' + encodeURIComponent(taskLabel(task)))}>
                <span className="task-ref">{taskLabel(task)}</span>
                <span className="task-title">{task.title}</span>
                <span className="task-pill" data-status={task.status}>{statusLabel(task.status)}</span>
              </button>
            ))}
          </section>
        </div>
      </div>

      {creating && <NewTaskDialog tasks={pod.tasks} board={pod.slug}
        seats={pod.seats.map(seat => ({ id: seat.id, description: seat.description, model: '', provider: '' }))}
        onClose={() => setCreating(false)}
        onCreated={async task => { setCreating(false); flash(`Created ${taskLabel(task)}`); await Promise.all([loadBoard(), load()]); }} />}
    </div>
  );
}
