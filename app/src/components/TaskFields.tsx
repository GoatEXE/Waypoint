import { useCallback, useEffect, useState } from 'react';
import { api, type BoardTask, type OrgSeat } from '../api';
import { taskLabel } from '../taskQueueModel';
import { useStore } from '../store';

export interface TaskDraft { title: string; body: string; assignee: string; parents: string[] }

export const emptyDraft: TaskDraft = { title: '', body: '', assignee: '', parents: [] };

export function useQueueData() {
  const { state, loadBoard } = useStore();
  const [seats, setSeats] = useState<OrgSeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const [tasks, s] = await Promise.all([loadBoard(), api.orgSeats().catch(() => null)]);
    if (s) setSeats(s.seats);
    setError(tasks ? '' : 'Could not load the task board.');
    setLoading(false);
  }, [loadBoard]);
  useEffect(() => { void reload(); }, [reload]);
  return { tasks: state.board, seats, loading, error, reload };
}

export function AssigneeSelect({ value, seats, disabled, onChange }: { value: string; seats: OrgSeat[]; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <select className="input" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      {seats.map(seat => <option key={seat.id} value={seat.id} title={seat.description || undefined}>{seat.id}</option>)}
    </select>
  );
}

export function TaskFields({ draft, onChange, tasks, seats, disabled }: { draft: TaskDraft; onChange: (draft: TaskDraft) => void; tasks: BoardTask[]; seats: OrgSeat[]; disabled?: boolean }) {
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value });
  const parentOptions = tasks.filter(t => t.status !== 'archived' && t.status !== 'done' && !draft.parents.includes(t.id));
  const [showParents, setShowParents] = useState(draft.parents.length > 0);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <label className="field"><span className="field-label">Title</span>
        <input className="input" value={draft.title} maxLength={200} disabled={disabled} onChange={e => set('title', e.target.value)} placeholder="What needs doing?" />
      </label>
      <label className="field"><span className="field-label">Description</span>
        <textarea className="input" rows={5} value={draft.body} maxLength={8000} disabled={disabled} onChange={e => set('body', e.target.value)} placeholder="Details and acceptance criteria" />
      </label>
      <label className="field"><span className="field-label">Assignee</span>
        <AssigneeSelect value={draft.assignee} seats={seats} disabled={disabled} onChange={v => set('assignee', v)} />
      </label>
      {!showParents && <button type="button" className="link-btn" disabled={disabled} onClick={() => setShowParents(true)}>+ Start after another task</button>}
      {showParents && (
        <div className="field"><span className="field-label">Start after</span>
          <span className="field-hint">This task waits until the tasks you pick here are finished.</span>
          <select className="input" value="" disabled={disabled || !parentOptions.length} onChange={e => e.target.value && set('parents', [...draft.parents, e.target.value])}>
            <option value="">{parentOptions.length ? 'Pick a task…' : 'No unfinished tasks'}</option>
            {parentOptions.map(t => <option key={t.id} value={t.id}>{taskLabel(t)} {t.title}</option>)}
          </select>
          {draft.parents.length > 0 && <div className="chips">
            {draft.parents.map(id => {
              const t = tasks.find(x => x.id === id);
              return <button key={id} type="button" className="chip mono" disabled={disabled} title="Remove" onClick={() => set('parents', draft.parents.filter(x => x !== id))}>{t ? taskLabel(t) : id} ×</button>;
            })}
          </div>}
        </div>
      )}
    </div>
  );
}
