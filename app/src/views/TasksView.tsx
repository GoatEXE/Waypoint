import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Project, type TaskStatus, type TaskSummary } from '../api';
import { WorkspaceHead } from '../components/ui';
import { TaskFields, draftToInput, emptyDraft, useQueueData, type TaskDraft } from '../components/TaskFields';
import { GROUP_BY, STATUSES, groupTasks, isBlocked, ownerLabel, statusLabel, taskLabel, type GroupBy, type OrgPod } from '../taskQueueModel';
import { useStore } from '../store';

const PREFS_KEY = 'waypoint-task-view';

function loadPrefs(): { layout: 'list' | 'board'; groupBy: GroupBy } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { layout: saved.layout === 'board' ? 'board' : 'list', groupBy: GROUP_BY.some(g => g.id === saved.groupBy) ? saved.groupBy : 'status' };
  } catch { return { layout: 'list', groupBy: 'status' }; }
}

function TaskMeta({ task, pods, projectName, blocked }: { task: TaskSummary; pods: OrgPod[]; projectName?: string; blocked: boolean }) {
  return (
    <span className="task-meta">
      {blocked && <span className="task-pill warn">blocked</span>}
      {projectName && <span className="task-pill">{projectName}</span>}
      {task.labels.map(l => <span key={l} className="task-pill">{l}</span>)}
      <span className="task-owner">{ownerLabel(task, pods)}</span>
    </span>
  );
}

export function TasksView() {
  const nav = useNavigate();
  const { flash } = useStore();
  const { tasks, projects, pods, loading, error, reload } = useQueueData();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);

  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {   } }, [prefs]);

  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name;
  const open = (task: TaskSummary) => nav('/tasks/' + encodeURIComponent(task.ref || task.id));

  const moveTo = async (taskId: string, status: TaskStatus) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === status) return;
    try {
      await api.updateTask(taskId, { status });
      await reload();
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not move the task'); }
  };

  return (
    <div className="page" style={{ maxWidth: prefs.layout === 'board' ? 1400 : 1040, gap: 20 }}>
      <WorkspaceHead title="Tasks" lede="Every task in the organization, by status, project, parent, or owner." />
      <div className="task-toolbar">
        <div className="segmented" role="group" aria-label="Layout">
          <button className={prefs.layout === 'list' ? 'on' : ''} aria-pressed={prefs.layout === 'list'} onClick={() => setPrefs(p => ({ ...p, layout: 'list' }))}>List</button>
          <button className={prefs.layout === 'board' ? 'on' : ''} aria-pressed={prefs.layout === 'board'} onClick={() => setPrefs(p => ({ ...p, layout: 'board' }))}>Board</button>
        </div>
        {prefs.layout === 'list' && <label className="task-groupby">Group by
          <select className="input" value={prefs.groupBy} onChange={e => setPrefs(p => ({ ...p, groupBy: e.target.value as GroupBy }))}>
            {GROUP_BY.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>}
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>New task</button>
      </div>

      {error && <div className="card" role="alert" style={{ padding: 12 }}>{error}</div>}
      {loading && !tasks.length && <div className="empty" role="status">Loading tasks…</div>}
      {!loading && !error && !tasks.length && <div className="empty">No tasks yet. Create one, or ask the CEO to plan the work.</div>}

      {prefs.layout === 'list' && groupTasks(tasks, prefs.groupBy, { projects, pods }).map(group => (
        <section key={group.key || 'none'} className="stack" style={{ gap: 6 }}>
          <div className="task-group-head" data-status={prefs.groupBy === 'status' ? group.key : undefined}>{prefs.groupBy === 'status' && <span className="status-dot" />}<span>{group.label}</span><span className="task-count">{group.tasks.length}</span></div>
          <div className="task-list">
            {group.tasks.map(task => (
              <button key={task.id} type="button" className="task-row" onClick={() => open(task)}>
                <span className="task-ref">{taskLabel(task)}</span>
                <span className="task-title">{task.summary}</span>
                {prefs.groupBy !== 'status' && <span className="task-pill status" data-status={task.status}>{statusLabel(task.status)}</span>}
                <TaskMeta task={task} pods={pods} projectName={prefs.groupBy === 'project' ? undefined : projectName(task.projectId)} blocked={isBlocked(task, tasks)} />
              </button>
            ))}
          </div>
        </section>
      ))}

      {prefs.layout === 'board' && tasks.length > 0 && (
        <div className="task-board">
          {STATUSES.map(status => {
            const column = tasks.filter(t => t.status === status.id).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
            return (
              <div key={status.id} data-status={status.id}
                className={'task-column' + (overColumn === status.id ? ' over' : '')}
                onDragOver={e => { e.preventDefault(); setOverColumn(status.id); }}
                onDragLeave={() => setOverColumn(c => (c === status.id ? null : c))}
                onDrop={e => { e.preventDefault(); setOverColumn(null); const id = e.dataTransfer.getData('text/plain'); if (id) void moveTo(id, status.id); }}>
                <div className="task-group-head"><span className="status-dot" /><span>{status.label}</span><span className="task-count">{column.length}</span></div>
                {column.map(task => (
                  <div key={task.id} className={'task-card' + (dragging === task.id ? ' dragging' : '')} draggable
                    onDragStart={e => { e.dataTransfer.setData('text/plain', task.id); setDragging(task.id); }}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => open(task)}>
                    <span className="task-ref">{taskLabel(task)}</span>
                    <span className="task-title">{task.summary}</span>
                    <TaskMeta task={task} pods={pods} projectName={projectName(task.projectId)} blocked={isBlocked(task, tasks)} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {creating && <NewTaskDialog tasks={tasks} projects={projects} pods={pods}
        onClose={() => setCreating(false)}
        onCreated={async task => { setCreating(false); flash(`Created ${taskLabel(task)}`); await reload(); }} />}
    </div>
  );
}

export function NewTaskDialog({ tasks, projects, pods, initial, onClose, onCreated }: {
  tasks: TaskSummary[]; projects: Project[]; pods: OrgPod[];
  initial?: Partial<TaskDraft>;
  onClose: () => void; onCreated: (task: TaskSummary) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>({ ...emptyDraft, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async () => {
    if (!draft.summary.trim() || busy) return;
    setBusy(true); setError('');
    try { onCreated(await api.createTask(draftToInput(draft))); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal" style={{ width: 640, padding: 22, gap: 18 }} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">NEW TASK</div>
          <h2 className="h1" style={{ fontSize: 20 }}>Create a task</h2>
        </div>
        <TaskFields draft={draft} onChange={setDraft} tasks={tasks} projects={projects} pods={pods} disabled={busy} />
        {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.summary.trim()}>{busy ? 'Creating…' : 'Create task'}</button>
        </div>
      </form>
    </div>
  );
}
