import { useCallback, useEffect, useState } from 'react';
import { api, type Project, type TaskInput, type TaskStatus, type TaskSummary } from '../api';
import { STATUSES, parseLabels, taskLabel, type OrgPod } from '../taskQueueModel';

export interface TaskDraft {
  summary: string;
  description: string;
  status: TaskStatus;
  assignee: string;
  projectId: string;
  labels: string;
  parentId: string;
  blockedBy: string[];
}

export const emptyDraft: TaskDraft = { summary: '', description: '', status: 'todo', assignee: '', projectId: '', labels: '', parentId: '', blockedBy: [] };

export function draftFromTask(task: TaskSummary): TaskDraft {
  return {
    summary: task.summary,
    description: task.description,
    status: task.status,
    assignee: task.podId ? `${task.podId}/${task.seatId || ''}` : '',
    projectId: task.projectId || '',
    labels: task.labels.join(', '),
    parentId: task.parentId || '',
    blockedBy: task.blockedBy,
  };
}

export function draftToInput(draft: TaskDraft): TaskInput {
  const [podId, seatId] = draft.assignee.split('/');
  return {
    summary: draft.summary.trim(),
    description: draft.description.trim(),
    status: draft.status,
    podId: podId || null,
    seatId: seatId || null,
    projectId: draft.projectId || null,
    labels: parseLabels(draft.labels),
    parentId: draft.parentId || null,
    blockedBy: draft.blockedBy,
  };
}

export function useQueueData() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pods, setPods] = useState<OrgPod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const [t, p, org] = await Promise.all([api.tasks(), api.projects(), api.orgChart()]);
      setTasks(t.tasks); setProjects(p.projects); setPods(org.pods); setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { tasks, projects, pods, loading, error, reload, setProjects };
}

interface Props {
  draft: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  tasks: TaskSummary[];
  projects: Project[];
  pods: OrgPod[];
  selfId?: string;
  onProjectCreated: (project: Project) => void;
  disabled?: boolean;
  showSummary?: boolean;
}

export function TaskFields({ draft, onChange, tasks, projects, pods, selfId, onProjectCreated, disabled, showSummary = true }: Props) {
  const [newProject, setNewProject] = useState<string | null>(null);
  const [projectError, setProjectError] = useState('');
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value });
  const others = tasks.filter(t => t.id !== selfId).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const blockerOptions = others.filter(t => !draft.blockedBy.includes(t.id));

  const createProject = async () => {
    if (!newProject?.trim()) return;
    try {
      const project = await api.createProject(newProject.trim());
      onProjectCreated(project);
      onChange({ ...draft, projectId: project.id });
      setNewProject(null); setProjectError('');
    } catch (e) { setProjectError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      {showSummary && <label className="field"><span className="field-label">Title</span>
        <input className="input" value={draft.summary} maxLength={200} disabled={disabled} onChange={e => set('summary', e.target.value)} placeholder="What needs doing?" />
      </label>}
      <label className="field"><span className="field-label">Description</span>
        <textarea className="input" rows={4} value={draft.description} maxLength={8000} disabled={disabled} onChange={e => set('description', e.target.value)} placeholder="Details and acceptance criteria" />
      </label>
      <div className="task-field-grid">
        <label className="field"><span className="field-label">Status</span>
          <select className="input" value={draft.status} disabled={disabled} onChange={e => set('status', e.target.value as TaskStatus)}>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Assignee</span>
          <select className="input" value={draft.assignee} disabled={disabled} onChange={e => set('assignee', e.target.value)}>
            <option value="">Unassigned</option>
            {pods.map(pod => (
              <optgroup key={pod.podId} label={pod.name}>
                <option value={`${pod.podId}/`}>{pod.name} (whole pod)</option>
                {pod.seats.map(seat => <option key={seat.seatId} value={`${pod.podId}/${seat.seatId}`}>{pod.name} / {seat.seatId}{seat.role ? ` · ${seat.role}` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="field"><span className="field-label">Project</span>
          {newProject === null ? (
            <select className="input" value={draft.projectId} disabled={disabled} onChange={e => e.target.value === '__new__' ? setNewProject('') : set('projectId', e.target.value)}>
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="__new__">New project…</option>
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" autoFocus value={newProject} maxLength={80} placeholder="Project name" onChange={e => setNewProject(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void createProject(); } }} style={{ flex: 1, minWidth: 0 }} />
              <button type="button" className="btn btn-ghost sm" onClick={() => void createProject()}>Add</button>
              <button type="button" className="btn btn-ghost sm" onClick={() => { setNewProject(null); setProjectError(''); }}>×</button>
            </div>
          )}
          {projectError && <span role="alert" style={{ fontSize: 12, color: 'var(--text)' }}>{projectError}</span>}
        </div>
        <label className="field"><span className="field-label">Labels</span>
          <input className="input" value={draft.labels} disabled={disabled} onChange={e => set('labels', e.target.value)} placeholder="frontend, urgent" />
        </label>
        <label className="field"><span className="field-label">Parent task</span>
          <select className="input" value={draft.parentId} disabled={disabled} onChange={e => set('parentId', e.target.value)}>
            <option value="">None</option>
            {others.map(t => <option key={t.id} value={t.id}>{taskLabel(t)} {t.summary}</option>)}
          </select>
        </label>
        <div className="field"><span className="field-label">Blocked by</span>
          <select className="input" value="" disabled={disabled || !blockerOptions.length} onChange={e => e.target.value && set('blockedBy', [...draft.blockedBy, e.target.value])}>
            <option value="">{blockerOptions.length ? 'Add a blocking task…' : 'No other tasks'}</option>
            {blockerOptions.map(t => <option key={t.id} value={t.id}>{taskLabel(t)} {t.summary}</option>)}
          </select>
          {draft.blockedBy.length > 0 && <div className="chips">
            {draft.blockedBy.map(id => {
              const t = tasks.find(x => x.id === id);
              return <button key={id} type="button" className="chip mono" disabled={disabled} title="Remove" onClick={() => set('blockedBy', draft.blockedBy.filter(x => x !== id))}>{t ? taskLabel(t) : id.slice(0, 13)} ×</button>;
            })}
          </div>}
        </div>
      </div>
    </div>
  );
}
