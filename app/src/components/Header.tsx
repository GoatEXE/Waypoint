import { useNavigate } from 'react-router-dom';
import type { BoardTask, Project } from '../api';
import { currentMission } from '../missionsModel';
import { useRoute, type Route } from '../routes';
import { useStore } from '../store';
import { PaneGlyph } from './ui';
import { DryRunBadge } from './DryRunBanner';

interface Crumb { label: string; to: string; mono?: boolean }

const WS: Partial<Record<Route['v'], string>> = { routines: 'Routines', artifacts: 'Artifacts', skills: 'Skills', connectors: 'Connectors', settings: 'Settings' };

export function crumbsFor(r: Route, missionTitle: string | null, projects: Project[], board: BoardTask[]): Crumb[] {
  const m: Crumb = { label: missionTitle || 'Workspace', to: '/' };
  const taskCrumbs = (key: string): Crumb[] => {
    const t = board.find(x => x.ref === key || x.id === key);
    return [m, { label: 'Tasks', to: '/tasks' }, { label: t?.ref || key, to: '/tasks/' + encodeURIComponent(key), mono: true }];
  };
  switch (r.v) {
    case 'mission': return [m];
    case 'project': return [m, { label: projects.find(p => p.id === r.id)?.name || 'Project', to: '/projects/' + r.id }];
    case 'task': return taskCrumbs(r.id!);
    case 'pod': return [{ label: 'Pods', to: '/pods/' + r.id }, { label: r.id!, to: '/pods/' + r.id, mono: true }];
    case 'inbox': return [{ label: 'Workspace', to: '/inbox' }, { label: 'Inbox', to: '/inbox' }];
    default: return WS[r.v] ? [{ label: 'Workspace', to: '/inbox' }, { label: WS[r.v]!, to: '/' + r.v }] : [m];
  }
}

export function Header() {
  const { state, setPane } = useStore();
  const nav = useNavigate();
  const route = useRoute();
  const crumbs = crumbsFor(route, currentMission(state.missions)?.title || null, state.projects, state.board);
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
      <DryRunBadge />
      <button className={'pane-toggle' + (state.pane.open ? ' on' : '')} title="Toggle side pane" onClick={() => setPane({ open: !state.pane.open })}>
        <PaneGlyph w={14} h={11} bar={4} r={2.5} bw={1.5} />
        Side pane
      </button>
    </header>
  );
}
