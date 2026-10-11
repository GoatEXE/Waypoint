import { useLocation } from 'react-router-dom';

export type View =
  | 'mission' | 'project' | 'task' | 'pod' | 'seat'
  | 'tasks' | 'org' | 'github' | 'inbox' | 'routines' | 'artifacts' | 'skills' | 'connectors' | 'settings' | 'help' | 'notfound';

export interface Route { v: View; id?: string }

export function parseRoute(path: string): Route {
  const [a, b, c] = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (!a) return { v: 'mission' };
  if (a === 'projects' && b && !c) return { v: 'project', id: b };
  if (a === 'tasks' && !b) return { v: 'tasks' };
  if (a === 'connectors' && b === 'github' && (c === 'callback' || c === 'installed')) return { v: 'github', id: c };
  if (a === 'tasks' && b && !c) return { v: 'task', id: b };
  if (a === 'pods' && b && !c) return { v: 'pod', id: b };
  if (a === 'seats' && b && !c) return { v: 'seat', id: b };
  if (!b && ['org', 'inbox', 'routines', 'artifacts', 'skills', 'connectors', 'settings', 'help'].includes(a)) return { v: a as View };
  return { v: 'notfound' };
}

export const useRoute = () => parseRoute(useLocation().pathname);

export function activeProject(r: Route): string | null {
  if (r.v === 'project') return r.id!;
  return null;
}
