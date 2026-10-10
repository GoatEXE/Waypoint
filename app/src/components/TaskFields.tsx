import { useCallback, useEffect, useState } from 'react';
import { api, type BoardTask, type OrgSeat } from '../api';
import { taskLabel } from '../taskQueueModel';

export interface TaskDraft { title: string; body: string; assignee: string; parents: string[] }

export const emptyDraft: TaskDraft = { title: '', body: '', assignee: '', parents: [] };

export function useQueueData() {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [seats, setSeats] = useState<OrgSeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api.tasks(), api.orgSeats()]);
      setTasks(t.tasks); setSeats(s.seats); setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { tasks, seats, loading, error, reload };
}

export function AssigneeSelect({ value, seats, disabled, onChange }: { value: string; seats: OrgSeat[]; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <select className="input" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      {seats.map(seat => <option key={seat.id} value={seat.id}>{seat.id}{seat.description ? ` · ${seat.description}` : ''}</option>)}
    </select>
  );
}

export function TaskFields({ draft, onChange, tasks, seats, disabled }: { draft: TaskDraft; onChange: (draft: TaskDraft) => void; tasks: BoardTask[]; seats: OrgSeat[]; disabled?: boolean }) {
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value });
  const parentOptions = tasks.filter(t => t.status !== 'archived' && !draft.parents.includes(t.id));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <label className="field"><span className="field-label">Title</span>
        <input className="input" value={draft.title} maxLength={200} disabled={disabled} onChange={e => set('title', e.target.value)} placeholder="What needs doing?" />
      </label>
      <label className="field"><span className="field-label">Description</span>
        <textarea className="input" rows={5} value={draft.body} maxLength={8000} disabled={disabled} onChange={e => set('body', e.target.value)} placeholder="Details and acceptance criteria" />
      </label>
      <div className="task-field-grid">
        <label className="field"><span className="field-label">Assignee</span>
          <AssigneeSelect value={draft.assignee} seats={seats} disabled={disabled} onChange={v => set('assignee', v)} />
        </label>
        <div className="field"><span className="field-label">Waits on</span>
          <select className="input" value="" disabled={disabled || !parentOptions.length} onChange={e => e.target.value && set('parents', [...draft.parents, e.target.value])}>
            <option value="">{parentOptions.length ? 'Add a task this waits on…' : 'No other tasks'}</option>
            {parentOptions.map(t => <option key={t.id} value={t.id}>{taskLabel(t)} {t.title}</option>)}
          </select>
          {draft.parents.length > 0 && <div className="chips">
            {draft.parents.map(id => {
              const t = tasks.find(x => x.id === id);
              return <button key={id} type="button" className="chip mono" disabled={disabled} title="Remove" onClick={() => set('parents', draft.parents.filter(x => x !== id))}>{t ? taskLabel(t) : id} ×</button>;
            })}
          </div>}
        </div>
      </div>
    </div>
  );
}
