import { useNavigate } from 'react-router-dom';
import * as D from '../data';
import { projById } from '../model';
import { useRoute, type Route } from '../routes';
import { useStore } from '../store';
import { PaneGlyph } from './ui';

interface Crumb { label: string; to: string; mono?: boolean }

const WS: Partial<Record<Route['v'], string>> = { routines: 'Routines', artifacts: 'Artifacts', skills: 'Skills', connectors: 'Connectors', settings: 'Settings' };

function crumbsFor(r: Route, projectName?: string): Crumb[] {
  const m: Crumb = { label: D.mission?.short || 'Workspace', to: '/' };
  const projCrumb = (pid: D.ProjectId): Crumb => {
    const p = projById(pid);
    return { label: p?.name || 'Project', to: p ? '/projects/' + pid : '/', mono: true };
  };
  const taskCrumbs = (tid: string): Crumb[] => {
    const t = D.tasks.find(x => x.id === tid);
    return t ? [m, projCrumb(t.p), { label: t.id, to: '/tasks/' + t.id, mono: true }] : [m, { label: tid, to: '/tasks/' + tid, mono: true }];
  };
  switch (r.v) {
    case 'mission': return [m];
    case 'project': return [m, { label: projectName || 'Project', to: '/projects/' + r.id }];
    case 'task': return taskCrumbs(r.id!);
    case 'seat': return [{ label: 'Organization', to: '/org' }, { label: r.id!, to: '/seats/' + r.id, mono: true }];
    case 'pod': return [{ label: 'Pods', to: '/pods/' + r.id }, { label: r.id!, to: '/pods/' + r.id, mono: true }];
    case 'inbox': return [{ label: 'Workspace', to: '/inbox' }, { label: 'Inbox', to: '/inbox' }];
    default: return WS[r.v] ? [{ label: 'Workspace', to: '/inbox' }, { label: WS[r.v]!, to: '/' + r.v }] : [m];
  }
}

export function Header() {
  const { state, setPane } = useStore();
  const nav = useNavigate();
  const route = useRoute();
  const crumbs = crumbsFor(route, route.v === 'project' ? state.projects.find(p => p.id === route.id)?.name : undefined);
  return (
    <header className="topbar">
      <nav className="crumbs">
        {crumbs.map((c, i) => (
          <div key={i} className="crumb">
            {i > 0 && <span className="crumb-sep">/</span>}
            <span className={'crumb-link' + (i === crumbs.length - 1 ? ' current' : '') + (c.mono ? ' mono' : '')} onClick={() => nav(c.to)}>{c.label}</span>
          </div>
        ))}
      </nav>
      <button className={'pane-toggle' + (state.pane.open ? ' on' : '')} title="Toggle side pane" onClick={() => setPane({ open: !state.pane.open })}>
        <PaneGlyph w={14} h={11} bar={4} r={2.5} bw={1.5} />
        Side pane
      </button>
    </header>
  );
}
