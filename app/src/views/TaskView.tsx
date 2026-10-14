import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type BoardTaskLink, type OrgSeat } from '../api';
import { useSplitCols } from '../components/layout';
import { AssigneeSelect, ProjectSelect } from '../components/TaskFields';
import { SeatFeedback } from '../components/SeatFeedback';
import { formatDateTime, TaskThread, useTaskActions, useTaskDetail } from '../components/TaskThread';
import { NO_PROJECT, statusLabel, taskLabel } from '../taskQueueModel';
import { useStore } from '../store';
import { ceoNameOf } from '../orgModel';

function TaskLinks({ title, links }: { title: string; links: BoardTaskLink[] }) {
  const nav = useNavigate();
  if (!links.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{title}</div>
      {links.map(link => (
        <span key={link.id} style={{ fontSize: 12.5 }}>
          <button type="button" className="ref-link" onClick={() => nav('/tasks/' + encodeURIComponent(link.ref || link.id))}>{link.ref || link.id}</button> {link.title}
          {link.assignee && <span style={{ color: 'var(--muted)' }}> · {link.assignee}</span>}
        </span>
      ))}
    </div>
  );
}

export function TaskView({ id }: { id: string }) {
  const nav = useNavigate();
  const splitCols = useSplitCols();
  const { state: appState, setCeoThread, setPane, loadBoard } = useStore();
  const { load, setLoad, loadTask, activity } = useTaskDetail(id);
  const actions = useTaskActions(load.status === 'ready' ? load.task : null, setLoad);
  const { busy, run, setConfirming, confirmPanel } = actions;
  const [seats, setSeats] = useState<OrgSeat[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState(false);

  useEffect(() => { setFeedback(false); }, [id]);
  useEffect(() => { api.orgSeats().then(r => setSeats(r.seats)).catch(() => undefined); }, []);
  const readyTaskId = load.status === 'ready' ? load.task.id : null;
  useEffect(() => { if (readyTaskId) setCeoThread(readyTaskId); }, [readyTaskId, setCeoThread]);

  const refresh = async () => { setRefreshing(true); await Promise.all([loadTask(), loadBoard()]); setRefreshing(false); };

  const refreshButton = <button className="btn lg btn-ghost" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>;
  if (load.status === 'loading') return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">TASK</div><h1 className="h1 mono">{id}</h1><p className="lede" role="status">Loading task…</p></div>;
  if (load.status === 'notfound') return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">NOT FOUND</div><h1 className="h1">Task not found</h1><p className="lede">No task exists for <span className="mono">{id}</span>.</p>{refreshButton}</div>;
  if (load.status === 'error') return <div className="page" style={{ maxWidth: 920, gap: 14 }}><div className="eyebrow">TASK</div><h1 className="h1">Couldn't load this task</h1><p className="lede" role="alert">{load.error}</p>{refreshButton}</div>;

  const { task } = load;
  const ref = taskLabel(task);
  const closed = task.status === 'done' || task.status === 'archived';
  const project = appState.projects.find(p => p.id === task.projectId);

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 28 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div className="page-head">
          <div className="eyebrow-row"><span>TASK</span><span className="sep">·</span><span>{ref}</span><span className="sep">·</span><span>{statusLabel(task.status).toUpperCase()}</span>{task.board !== 'default' && <><span className="sep">·</span><button type="button" className="ref-link" onClick={() => nav('/pods/' + task.board.replace(/^pod-/, ''))}>POD {task.board.replace(/^pod-/, '').toUpperCase()}</button></>}</div>
          <h1 className="h1">{task.title}</h1>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {task.assignee && <button className="btn lg btn-ghost" onClick={() => setFeedback(true)}>Feedback for {task.assignee}</button>}
          <button className="btn lg btn-ghost" onClick={() => { setCeoThread(task.id); setPane({ open: true, tab: 'tasks', taskView: 'ceo' }); }}>Discuss with {ceoNameOf(appState.org.organization)}</button>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: splitCols, gap: 36 }}>
        <TaskThread task={task} activity={activity} actions={actions}>
          {feedback && task.assignee && <SeatFeedback seat={task.assignee} taskRef={ref} onClose={() => setFeedback(false)} onSent={() => void loadTask()} />}
        </TaskThread>

        <div className="stack" style={{ gap: 20 }}>
          <label className="field"><span className="field-label">Assignee</span>
            <AssigneeSelect value={task.assignee || ''} seats={seats} disabled={busy || closed} onChange={v => void run(() => api.taskAction(ref, { action: 'assign', assignee: v || null }))} />
          </label>
          <label className="field"><span className="field-label">Project</span>
            <ProjectSelect value={project ? task.projectId! : ''} projects={appState.projects} placeholder={`${NO_PROJECT}: pick a project…`} disabled={busy || task.status === 'archived'}
              onChange={v => void run(() => api.taskAction(ref, { action: 'project', project: v }))} />
            {!project && <span className="field-hint">This task was made before every task needed a project. Pick one to file it.</span>}
          </label>
          <div className="kv-grid" style={{ display: 'flex', flexDirection: 'column' }}>
            {([
              ['Status', statusLabel(task.status)],
              ['Created', formatDateTime(task.createdAt)],
              ['Started', formatDateTime(task.startedAt)],
              ['Completed', formatDateTime(task.completedAt)],
            ] as const).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="kv" style={{ padding: '10px 12px', gap: 2 }}><span className="k">{k}</span><span className="v" style={{ fontSize: 12 }}>{v}</span></div>
            ))}
          </div>
          <TaskLinks title="Waits on" links={task.parents} />
          <TaskLinks title="Starts after this" links={task.children} />
          {task.status !== 'archived' && (confirmPanel('archive') || <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => setConfirming('archive')}>Archive</button>)}
        </div>
      </div>
    </div>
  );
}
