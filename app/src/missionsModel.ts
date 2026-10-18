import type { BoardTask, Mission, MissionStatus, Project } from './api';
import type { Route } from './routes';

export const MISSION_STATUSES: MissionStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];

export interface MissionsState { status: 'loading' | 'ready' | 'error'; missions: Mission[]; error: string | null }

export const initialMissionsState: MissionsState = { status: 'loading', missions: [], error: null };

export const missionsLoadStarted = (s: MissionsState): MissionsState => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading', error: null });
export const missionsLoadSucceeded = (missions: Mission[]): MissionsState => ({ status: 'ready', missions, error: null });
export const missionsLoadFailed = (s: MissionsState, error: string): MissionsState => ({ ...s, status: 'error', error });

export const SIDEBAR_MISSION_LIMIT = 3;

export const missionPath = (id: string) => '/missions/' + encodeURIComponent(id);

export function missionFor(s: MissionsState, id?: string | null): Mission | null {
  if (s.status !== 'ready') return null;
  if (id === undefined) return s.missions[0] ?? null;
  return s.missions.find(m => m.id === id) ?? null;
}

export function routeMission(s: MissionsState, r: Route, projects: Pick<Project, 'id' | 'missionId'>[], board: Pick<BoardTask, 'id' | 'ref' | 'projectId'>[]): Mission | null {
  const ofProject = (projectId?: string | null) => {
    const missionId = projects.find(p => p.id === projectId)?.missionId;
    return missionId ? missionFor(s, missionId) : null;
  };
  if (r.v === 'mission') return missionFor(s, r.id);
  if (r.v === 'project') return ofProject(r.id);
  if (r.v === 'task') return ofProject(board.find(t => t.ref === r.id || t.id === r.id)?.projectId);
  return null;
}

export function visibleMissions(missions: Mission[], expanded: boolean, activeId?: string | null): { shown: Mission[]; hidden: number } {
  const activeIndex = activeId ? missions.findIndex(m => m.id === activeId) : -1;
  if (expanded || missions.length <= SIDEBAR_MISSION_LIMIT) return { shown: missions, hidden: 0 };
  const shown = missions.slice(0, SIDEBAR_MISSION_LIMIT);
  if (activeIndex >= SIDEBAR_MISSION_LIMIT) shown.push(missions[activeIndex]);
  return { shown, hidden: missions.length - shown.length };
}

export function moveMission(missions: Mission[], id: string, targetId: string, place: 'before' | 'after'): Mission[] {
  const moving = missions.find(m => m.id === id);
  if (!moving || id === targetId || !missions.some(m => m.id === targetId)) return missions;
  const rest = missions.filter(m => m.id !== id);
  const at = rest.findIndex(m => m.id === targetId) + (place === 'after' ? 1 : 0);
  rest.splice(at, 0, moving);
  return rest;
}

export function sidebarMissionLabel(s: MissionsState): string {
  if (s.status === 'loading') return 'Loading…';
  if (s.status === 'error') return 'Missions unavailable';
  return s.missions[0]?.title || 'No mission yet';
}

export function missionStatusLabel(m: Pick<Mission, 'status'>): string {
  const title = (m.status || 'backlog').replace(/_/g, ' ');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function shortDate(iso: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
