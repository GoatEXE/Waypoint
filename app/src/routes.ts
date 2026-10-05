import { useLocation } from 'react-router-dom';
import * as D from './data';

export type View =
  | 'mission' | 'project' | 'task' | 'run' | 'pod' | 'review'
  | 'inbox' | 'routines' | 'artifacts' | 'skills' | 'connectors' | 'notfound';

export interface Route { v: View; id?: string }

export function parseRoute(path: string): Route {
  const [a, b, c] = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (!a) return { v: 'mission' };
  if (a === 'projects' && D.projects.some(p => p.id === b)) return { v: 'project', id: b };
  if (a === 'tasks' && D.tasks.some(t => t.id === b)) return { v: 'task', id: b };
  if (a === 'runs' && b in D.runs) return { v: 'run', id: b };
  if (a === 'pods' && D.pods.some(p => p.name === b)) return c === 'review' ? (b === 'web-squad-01' ? { v: 'review', id: b } : { v: 'notfound' }) : { v: 'pod', id: b };
  if (!b && ['inbox', 'routines', 'artifacts', 'skills', 'connectors'].includes(a)) return { v: a as View };
  return { v: 'notfound' };
}

export const useRoute = () => parseRoute(useLocation().pathname);

/** The thing the CEO chat is scoped to on the current page. */
export function chatContextFor(r: Route): string {
  if (r.v === 'task' || r.v === 'run') return r.id!;
  if (r.v === 'project') return D.projects.find(p => p.id === r.id)!.name;
  if (r.v === 'pod' || r.v === 'review') return r.id || 'web-squad-01';
  return 'mission';
}

/** Project the current page belongs to, if any (for sidebar highlighting). */
export function activeProject(r: Route): string | null {
  if (r.v === 'project') return r.id!;
  if (r.v === 'task') return D.tasks.find(t => t.id === r.id)!.p;
  if (r.v === 'run') return D.tasks.find(t => t.id === D.runs[r.id!].task)!.p;
  return null;
}
