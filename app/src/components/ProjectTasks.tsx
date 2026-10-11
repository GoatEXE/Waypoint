import { useNavigate } from 'react-router-dom';
import type { BoardTask } from '../api';
import { statusCounts } from '../projectProgress';
import { statusLabel, taskLabel } from '../taskQueueModel';

export function StatusCounts({ tasks }: { tasks: BoardTask[] }) {
  const counts = statusCounts(tasks);
  if (!counts.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {counts.map(c => <span key={c.status} className="task-pill">{statusLabel(c.status)} {c.count}</span>)}
    </div>
  );
}

export function ProjectTaskList({ tasks, limit = 12 }: { tasks: BoardTask[]; limit?: number }) {
  const nav = useNavigate();
  if (!tasks.length) return <div className="empty">No tasks yet.</div>;
  return (
    <div className="list">
      {tasks.slice(0, limit).map(t => (
        <div key={t.id} className="row link" style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '10px 16px' }} onClick={() => nav('/tasks/' + encodeURIComponent(taskLabel(t)))}>
          <span className="task-ref">{taskLabel(t)}</span>
          <span className="ellipsis" style={{ flex: 1 }}>{t.title}</span>
          {t.assignee && <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{t.assignee}</span>}
          <span className="task-pill">{statusLabel(t.status)}</span>
        </div>
      ))}
    </div>
  );
}
