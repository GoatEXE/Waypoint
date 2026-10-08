import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GitHubStatus, type LocalRepoInfo, type Project, type TaskSummary } from '../api';
import { useStore } from '../store';
import { FolderField } from '../components/ProjectDialog';
import { RepoSelect } from '../components/RepoSelect';
import { STATUSES, ownerLabel, taskLabel, type OrgPod } from '../taskQueueModel';
import { NewTaskDialog } from './TasksView';

function RepoSettings({ project, pods, github, onSaved }: { project: Project; pods: OrgPod[]; github: GitHubStatus | null; onSaved: (p: Project, installed: string[]) => void }) {
  const { state } = useStore();
  const [name, setName] = useState(project.name);
  const [missionId, setMissionId] = useState(project.missionId || '');
  const [localPath, setLocalPath] = useState(project.localPath || '');
  const [repo, setRepo] = useState(project.repo || '');
  const [seats, setSeats] = useState<string[]>(project.githubSeats || []);
  const [info, setInfo] = useState<LocalRepoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = name.trim() !== project.name || missionId !== (project.missionId || '') || localPath !== (project.localPath || '') || repo !== (project.repo || '') || seats.join() !== (project.githubSeats || []).join();

  useEffect(() => {
    if (project.localPath) void api.inspectLocalPath(project.localPath).then(setInfo).catch(() => setInfo(null));
  }, [project.localPath]);

  const inspect = async (path: string) => {
    if (!path.trim()) { setInfo(null); return; }
    try {
      const found = await api.inspectLocalPath(path.trim());
      setInfo(found);
      if (found.repo && !repo) setRepo(found.repo);
    } catch (e) { setInfo(null); setError(e instanceof Error ? e.message : String(e)); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const saved = await api.updateProject(project.id, { name: name.trim(), missionId: missionId || null, localPath: localPath.trim() || null, repo: repo.trim() || null, githubSeats: seats });
      onSaved(saved, (saved as Project & { toolsInstalled?: string[] }).toolsInstalled || []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="Project settings">
      <div className="task-field-grid">
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)} />
        </label>
        {!project.missionId && <label className="field"><span className="field-label">Mission</span>
          <select className="input" value={missionId} onChange={e => setMissionId(e.target.value)}>
            <option value="">Choose a mission</option>
            {state.missions.missions.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>}
        <FolderField value={localPath} onChange={setLocalPath} info={info} onInspect={path => void inspect(path)} />
        <div className="field"><span className="field-label">GitHub repository</span>
          <RepoSelect value={repo} onChange={setRepo} github={github} />
        </div>
      </div>
      <div className="field"><span className="field-label">Seats with GitHub access</span>
        {pods.length ? <div className="chips">{pods.flatMap(pod => pod.seats.map(seat => {
          const address = `${pod.podId}/${seat.seatId}`;
          const on = seats.includes(address);
          return <button key={address} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setSeats(s => on ? s.filter(x => x !== address) : [...s, address])}>{pod.name} / {seat.seatId}</button>;
        }))}</div> : <span style={{ fontSize: 12, color: 'var(--faint)' }}>No pods yet.</span>}
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
      {dirty && <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save project'}</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => { setName(project.name); setMissionId(project.missionId || ''); setLocalPath(project.localPath || ''); setRepo(project.repo || ''); setSeats(project.githubSeats || []); }}>Discard</button>
      </div>}
    </section>
  );
}

export function ProjectView({ id }: { id: string }) {
  const { state, loadProjects, flash } = useStore();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [pods, setPods] = useState<OrgPod[]>([]);
  const [github, setGithub] = useState<GitHubStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const project = state.projects.find(p => p.id === id);

  const loadTasks = () => api.tasks().then(t => setTasks(t.tasks)).catch(() => undefined);
  useEffect(() => {
    void loadTasks();
    api.orgChart().then(c => setPods(c.pods)).catch(() => undefined);
    api.githubStatus().then(setGithub).catch(() => undefined);
  }, [id]);

  if (!project) {
    return <div className="page" style={{ maxWidth: 920, gap: 12 }}><div className="eyebrow">PROJECT</div><h1 className="h1">{state.projects.length ? 'Project not found' : 'Loading project…'}</h1></div>;
  }
  const mission = state.missions.missions.find(m => m.id === project.missionId);
  const remove = async () => {
    if (!window.confirm(`Delete project ${project.name}? Its repository settings are removed; the repository itself is not touched.`)) return;
    try { await api.deleteProject(project.id); await loadProjects(); flash(`Deleted ${project.name}`); nav('/'); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
  };
  const projectTasks = tasks.filter(t => t.projectId === project.id).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const open = projectTasks.filter(t => t.status !== 'done' && t.status !== 'canceled').length;

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 24 }}>
      <div className="page-head">
        <div className="eyebrow">PROJECT</div>
        <h1 className="h1">{project.name}</h1>
        <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>
          {mission ? <>Part of <span className="ul" onClick={() => nav('/')}>{mission.title}</span></> : 'Not attached to a mission'}
          {project.repo && <> · <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer" className="mono">{project.repo}</a></>}
          {' · '}{open} open task{open === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -12 }}>
        <button className="btn btn-ghost sm" onClick={() => void remove()}>Delete project</button>
      </div>

      <RepoSettings key={project.updatedAt} project={project} pods={pods} github={github} onSaved={(_p, installed) => { void loadProjects(); flash(installed.length ? `Saved; GitHub tools installed for ${installed.length} seat${installed.length === 1 ? '' : 's'}` : 'Project saved'); }} />

      <section className="stack" style={{ gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="section-title">Tasks</div>
          <button className="btn btn-primary sm" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>New task</button>
        </div>
        {!projectTasks.length && <div className="empty">No tasks in this project yet.</div>}
        {STATUSES.map(status => {
          const group = projectTasks.filter(t => t.status === status.id);
          if (!group.length) return null;
          return (
            <div key={status.id} className="stack" style={{ gap: 6 }}>
              <div className="task-group-head" data-status={status.id}><span className="status-dot" /><span>{status.label}</span><span className="task-count">{group.length}</span></div>
              <div className="task-list">
                {group.map(task => (
                  <button key={task.id} type="button" className="task-row" onClick={() => nav('/tasks/' + encodeURIComponent(task.ref || task.id))}>
                    <span className="task-ref">{taskLabel(task)}</span>
                    <span className="task-title">{task.summary}</span>
                    <span className="task-owner">{ownerLabel(task, pods)}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {creating && <NewTaskDialog tasks={tasks} projects={state.projects} pods={pods} initial={{ projectId: project.id }}
        onClose={() => setCreating(false)}
        onCreated={async task => { setCreating(false); flash(`Created ${taskLabel(task)}`); await loadTasks(); }} />}
    </div>
  );
}
