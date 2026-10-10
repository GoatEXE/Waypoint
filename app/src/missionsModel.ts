import type { Mission, MissionStatus } from './api';

export const MISSION_STATUSES: MissionStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];

export interface MissionsState { status: 'loading' | 'ready' | 'error'; missions: Mission[]; error: string | null }

export const initialMissionsState: MissionsState = { status: 'loading', missions: [], error: null };

export const missionsLoadStarted = (s: MissionsState): MissionsState => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading', error: null });
export const missionsLoadSucceeded = (missions: Mission[]): MissionsState => ({ status: 'ready', missions, error: null });
export const missionsLoadFailed = (s: MissionsState, error: string): MissionsState => ({ ...s, status: 'error', error });

export const currentMission = (s: MissionsState): Mission | null => (s.status === 'ready' ? s.missions[0] ?? null : null);

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
