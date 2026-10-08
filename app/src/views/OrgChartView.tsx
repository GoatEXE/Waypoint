import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type HermesStatus, type TaskSummary } from '../api';
import { OnDot, WorkspaceHead } from '../components/ui';
import { useStore } from '../store';
import { ceoNameOf } from '../orgModel';
import { buildOrgTree, type OrgChartData } from '../orgChartModel';
import { taskLabel } from '../taskQueueModel';

function TaskChip({ task }: { task: TaskSummary }) {
  const nav = useNavigate();
  return (
    <button type="button" className="org-task" data-status={task.status} title={task.summary} onClick={e => { e.stopPropagation(); nav('/tasks/' + encodeURIComponent(task.ref || task.id)); }}>
      <span className="status-dot" /><span className="mono">{taskLabel(task)}</span><span className="org-task-title">{task.summary}</span>
    </button>
  );
}

export function OrgChartView() {
  const nav = useNavigate();
  const { state, setCeoThread, setPane } = useStore();
  const [chart, setChart] = useState<OrgChartData | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [ceo, setCeo] = useState<HermesStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [c, t] = await Promise.all([api.orgChart(), api.tasks()]);
        if (!active) return;
        setChart(c as OrgChartData); setTasks(t.tasks); setError('');
      } catch (e) { if (active) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    api.hermesStatus().then(s => active && setCeo(s)).catch(() => undefined);
    const timer = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const org = state.org.organization;
  const ceoName = ceoNameOf(org);
  const tree = chart ? buildOrgTree(chart, tasks) : null;

  return (
    <div className="page" style={{ maxWidth: 1280, gap: 24 }}>
      <WorkspaceHead title="Organization" />
      {error && <div className="card" role="alert" style={{ padding: 12 }}>{error}</div>}
      {!tree && !error && <div className="empty" role="status">Loading organization…</div>}
      {tree && (
        <div className="org-tree">
          <div className="org-level">
            <div className="org-node org-root">
              {org?.logo ? <img className="brand-logo" src={org.logo} alt="" /> : <div className="brand-mark" />}
              <div className="stack" style={{ minWidth: 0 }}>
                <span className="org-name">{org?.name || 'Organization'}</span>
                <span className="org-sub">{tree.pods.length} pod{tree.pods.length === 1 ? '' : 's'} · {tree.pods.reduce((n, p) => n + p.seats.length, 0)} seats</span>
              </div>
            </div>
          </div>
          <div className="org-stem" />
          <div className="org-level">
            <button type="button" className="org-node org-ceo" onClick={() => { setCeoThread('general'); setPane({ open: true, tab: 'ceo' }); }}>
              <div className="ceo-mark" />
              <div className="stack" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                <span className="org-name">{ceoName}</span>
                <span className="org-sub">CEO · {ceo?.model.configured ? ceo.model.default : 'model not set'}</span>
              </div>
              <span className="org-state"><OnDot on={Boolean(ceo?.runtime.running)} />{ceo ? (ceo.runtime.running ? 'running' : ceo.runtime.state) : '…'}</span>
            </button>
          </div>
          {tree.unassigned.length > 0 && (
            <div className="org-unassigned">
              <span className="org-sub">Unassigned · {tree.unassigned.length}</span>
              <div className="org-tasks">{tree.unassigned.slice(0, 6).map(t => <TaskChip key={t.id} task={t} />)}</div>
            </div>
          )}
          {tree.pods.length > 0 && <div className="org-stem" />}
          {tree.pods.length === 0 && <div className="empty">No pods yet.</div>}
          <div className="org-pods">
            {tree.pods.map(pod => (
              <div key={pod.podId} className="org-branch">
                <button type="button" className="org-node org-pod" onClick={() => nav('/pods/' + pod.podId)}>
                  <div className="stack" style={{ minWidth: 0, alignItems: 'flex-start' }}>
                    <span className="org-name">{pod.name}</span>
                    <span className="org-sub">{pod.openCount} open task{pod.openCount === 1 ? '' : 's'}{pod.runningCount ? ` · ${pod.runningCount} running` : ''}</span>
                  </div>
                  <span className="org-state"><OnDot on={pod.state === 'running'} />{pod.state}</span>
                </button>
                {pod.podOnly.length > 0 && <div className="org-tasks" style={{ padding: '0 6px' }}>{pod.podOnly.map(t => <TaskChip key={t.id} task={t} />)}</div>}
                <div className="org-seats">
                  {pod.seats.map(seat => (
                    <div key={seat.seatId} className={'org-node org-seat' + (seat.running ? ' busy' : '')} title={`Chat with ${seat.seatId}`} onClick={() => { setCeoThread(`seat:${pod.podId}/${seat.seatId}`); setPane({ open: true, tab: 'ceo' }); }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                        <span className="org-name mono">{seat.seatId}</span>
                        <span className="org-sub ellipsis">{seat.role}</span>
                      </div>
                      {seat.running ? <span className="org-working">working on {taskLabel(seat.running)}</span> : <span className="org-sub">{seat.open.length ? `${seat.open.length} open` : 'idle'}</span>}
                      {seat.open.length > 0 && <div className="org-tasks">{seat.open.slice(0, 4).map(t => <TaskChip key={t.id} task={t} />)}{seat.open.length > 4 && <span className="org-sub">+{seat.open.length - 4} more</span>}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
