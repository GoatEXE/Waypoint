import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type BoardStatus, type BoardTask, type OrgSeat } from '../api';
import { WorkspaceHead } from '../components/ui';
import { TaskFields, emptyDraft, useQueueData, type TaskDraft } from '../components/TaskFields';
import { GROUP_BY, STATUSES, filterByStatus, groupTasks, savedStatusFilter, statusLabel, taskLabel, toggleStatusFilter, type GroupBy } from '../taskQueueModel';
import { useStore } from '../store';
import { errorText } from '../runtimeHealth';

const PREFS_KEY = 'waypoint-task-view';

interface ViewPrefs { layout: 'list' | 'board'; groupBy: GroupBy; statuses: BoardStatus[] }

function loadPrefs(): ViewPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { layout: saved.layout === 'board' ? 'board' : 'list', groupBy: GROUP_BY.some(g => g.id === saved.groupBy) ? saved.groupBy : 'status', statuses: savedStatusFilter(saved.statuses) };
  } catch { return { layout: 'list', groupBy: 'status', statuses: [] }; }
}

function TaskMeta({ task }: { task: BoardTask }) {
  return (
    <span className="task-meta">
      {task.board !== 'default' && <span className="task-pill mono">{task.board.replace(/^pod-/, '')}</span>}
      {task.lastError && <span className="task-pill warn">error</span>}
      <span className="task-owner">{task.assignee || 'Unassigned'}</span>
    </span>
  );
}

export function TasksView() {
  const nav = useNavigate();
  const { flash } = useStore();
  const { tasks, seats, loading, error, reload } = useQueueData();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [creating, setCreating] = useState(false);

  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {   } }, [prefs]);

  const shown = filterByStatus(tasks, prefs.statuses);
  const columns = prefs.statuses.length ? STATUSES.filter(s => prefs.statuses.includes(s.id)) : STATUSES.filter(s => s.id !== 'archived');
  const showAll = () => setPrefs(p => ({ ...p, statuses: [] }));
  const open = (task: BoardTask) => nav('/tasks/' + encodeURIComponent(taskLabel(task)));

  return (
    <div className="page" style={{ maxWidth: prefs.layout === 'board' ? 1400 : 1040, gap: 20 }}>
      <WorkspaceHead title="Tasks" />
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
        <div className="segmented" role="group" aria-label="Status filter">
          <button className={!prefs.statuses.length ? 'on' : ''} aria-pressed={!prefs.statuses.length} onClick={showAll}>All</button>
          {STATUSES.map(s => (
            <button key={s.id} className={prefs.statuses.includes(s.id) ? 'on' : ''} aria-pressed={prefs.statuses.includes(s.id)} onClick={() => setPrefs(p => ({ ...p, statuses: toggleStatusFilter(p.statuses, s.id) }))}>{s.label}</button>
          ))}
        </div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>Add task</button>
      </div>

      {error && <div className="card" role="alert" style={{ padding: 12 }}>{error}</div>}
      {loading && !tasks.length && <div className="empty" role="status">Loading tasks…</div>}
      {!loading && !error && !tasks.length && <div className="empty">No tasks yet.</div>}
      {!loading && !error && tasks.length > 0 && !shown.length && (
        <div className="empty">No tasks match this filter. <button type="button" className="btn sm btn-ghost" onClick={showAll}>Show all</button></div>
      )}

      {prefs.layout === 'list' && groupTasks(shown, prefs.groupBy).map(group => (
        <section key={group.key || 'none'} className="stack" style={{ gap: 6 }}>
          <div className="task-group-head" data-status={prefs.groupBy === 'status' ? group.key : undefined}>{prefs.groupBy === 'status' && <span className="status-dot" />}<span>{group.label}</span><span className="task-count">{group.tasks.length}</span></div>
          <div className="task-list">
            {group.tasks.map(task => (
              <button key={task.id} type="button" className="task-row" onClick={() => open(task)}>
                <span className="task-ref">{taskLabel(task)}</span>
                <span className="task-title">{task.title}</span>
                {prefs.groupBy !== 'status' && <span className="task-pill status" data-status={task.status}>{statusLabel(task.status)}</span>}
                <TaskMeta task={task} />
              </button>
            ))}
          </div>
        </section>
      ))}

      {prefs.layout === 'board' && shown.length > 0 && (
        <div className="task-board">
          {columns.map(status => {
            const column = groupTasks(shown.filter(t => t.status === status.id), 'status')[0]?.tasks || [];
            return (
              <div key={status.id} data-status={status.id} className="task-column">
                <div className="task-group-head"><span className="status-dot" /><span>{status.label}</span><span className="task-count">{column.length}</span></div>
                {column.map(task => (
                  <div key={task.id} className="task-card" onClick={() => open(task)}>
                    <span className="task-ref">{taskLabel(task)}</span>
                    <span className="task-title">{task.title}</span>
                    <TaskMeta task={task} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {creating && <NewTaskDialog tasks={tasks} seats={seats}
        onClose={() => setCreating(false)}
        onCreated={async task => { setCreating(false); flash(`Added ${taskLabel(task)} to the board`); await reload(); }} />}
    </div>
  );
}

export function NewTaskDialog({ tasks, seats, board, initial, initialProject = '', onClose, onCreated }: {
  tasks: BoardTask[]; seats: OrgSeat[]; board?: string;
  initial?: Partial<TaskDraft>; initialProject?: string;
  onClose: () => void; onCreated: (task: BoardTask) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>({ ...emptyDraft, ...initial });
  const { state } = useStore();
  const repoProjects = state.projects.filter(p => p.repo);
  const [project, setProject] = useState(initialProject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async () => {
    if (!draft.title.trim() || busy) return;
    setBusy(true); setError('');
    try { onCreated(await api.createTask({ title: draft.title.trim(), body: draft.body.trim(), assignee: draft.assignee || null, parents: draft.parents, ...(board ? { board } : {}), ...(project ? { project } : {}) })); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal" style={{ width: 640, padding: 22, gap: 18 }} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">ADD TO BOARD</div>
          <h2 className="h1" style={{ fontSize: 20 }}>Add a task</h2>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Goes straight onto the board{board ? ` of pod ${board}` : ''}. If you assign a seat, it picks the task up once any parent tasks are done.</div>
        </div>
        <TaskFields draft={draft} onChange={setDraft} tasks={tasks} seats={seats} disabled={busy} />
        {!board && <label className="field"><span className="field-label">Project</span>
          <select className="input" value={project} disabled={busy} onChange={e => setProject(e.target.value)}>
            <option value="">No project</option>
            {repoProjects.map(p => <option key={p.id} value={p.id}>{p.name} · {p.repo}</option>)}
          </select>
          {project && <span className="field-hint">The seat works in its own branch of {repoProjects.find(p => p.id === project)?.repo}.</span>}
        </label>}
        {error && <div role="alert" className="form-error">{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.title.trim()}>{busy ? 'Adding…' : 'Add task'}</button>
        </div>
      </form>
    </div>
  );
}
