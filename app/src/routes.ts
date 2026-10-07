import { useLocation } from 'react-router-dom';
import * as D from './data';

export type View =
  | 'mission' | 'project' | 'task' | 'run' | 'pod' | 'review'
  | 'inbox' | 'routines' | 'artifacts' | 'skills' | 'connectors' | 'settings' | 'notfound';

export interface Route { v: View; id?: string }

export function parseRoute(path: string): Route {
  const [a, b, c] = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (!a) return { v: 'mission' };
  if (a === 'projects' && D.projects.some(p => p.id === b)) return { v: 'project', id: b };
  if (a === 'tasks' && b && !c) return { v: 'task', id: b };
  if (a === 'runs' && b in D.runs) return { v: 'run', id: b };
  if (a === 'pods' && b) return c === 'review' ? { v: 'review', id: b } : !c ? { v: 'pod', id: b } : { v: 'notfound' };
  if (!b && ['inbox', 'routines', 'artifacts', 'skills', 'connectors', 'settings'].includes(a)) return { v: a as View };
  return { v: 'notfound' };
}

export const useRoute = () => parseRoute(useLocation().pathname);

/** The thing the CEO chat is scoped to on the current page. */
export function chatContextFor(r: Route): string {
  if ((r.v === 'task' || r.v === 'run') && r.id) return r.id;
  if (r.v === 'project') return D.projects.find(p => p.id === r.id)?.name || 'project';
  if (r.v === 'pod' || r.v === 'review') return r.id || 'pod';
  return D.mission?.short || 'workspace';
}

/** Project the current page belongs to, if any (for sidebar highlighting). */
export function activeProject(r: Route): string | null {
  if (r.v === 'project') return r.id!;
  if (r.v === 'task') return D.tasks.find(t => t.id === r.id)?.p || null;
  if (r.v === 'run') {
    const taskId = r.id ? D.runs[r.id]?.task : undefined;
    return taskId ? D.tasks.find(t => t.id === taskId)?.p || null : null;
  }
  return null;
}
