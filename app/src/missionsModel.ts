import type { Mission, MissionPod } from './api';

export interface MissionsState { status: 'loading' | 'ready' | 'error'; missions: Mission[]; error: string | null }

export const initialMissionsState: MissionsState = { status: 'loading', missions: [], error: null };

export const missionsLoadStarted = (s: MissionsState): MissionsState => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading', error: null });
export const missionsLoadSucceeded = (missions: Mission[]): MissionsState => ({ status: 'ready', missions, error: null });
export const missionsLoadFailed = (s: MissionsState, error: string): MissionsState => ({ ...s, status: 'error', error });

/** The service lists newest first; the home page leads with the newest mission. */
export const currentMission = (s: MissionsState): Mission | null => (s.status === 'ready' ? s.missions[0] ?? null : null);

export function sidebarMissionLabel(s: MissionsState): string {
  if (s.status === 'loading') return 'Loading…';
  if (s.status === 'error') return 'Missions unavailable';
  return s.missions[0]?.title || 'No mission yet';
}

/** Distinct pods linked to any mission, in mission order. */
export function missionPods(missions: Mission[]): MissionPod[] {
  const seen = new Map<string, MissionPod>();
  for (const m of missions) if (m.pod && !seen.has(m.pod.id)) seen.set(m.pod.id, m.pod);
  return [...seen.values()];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function podStateLabel(state: string): string {
  if (state === 'planned') return 'Set up, not running';
  if (state === 'running') return 'Running';
  return cap(state || 'unknown');
}

export function taskStateLabel(state: string): string {
  if (state === 'delegated') return 'Handed off, not started';
  return cap(state || 'unknown');
}

/**
 * Plain-language status for a mission. Only reports what Waypoint has on record:
 * a handed-off task is not described as running or done.
 */
export function missionStatus(m: Mission): { label: string; detail: string } {
  if (m.missing.length) {
    return { label: 'Needs attention', detail: `The linked ${m.missing.join(' and ')} record could not be found.` };
  }
  if (m.task) {
    const where = m.pod ? ` in ${m.pod.podName}` : '';
    if (m.task.state === 'delegated') return { label: 'Delegated', detail: `Handed to the ${m.task.seatId} seat${where}. No work has run yet.` };
    return { label: cap(m.task.state), detail: `The ${m.task.seatId} seat${where} reports: ${m.task.state}.` };
  }
  if (m.pod) return { label: 'Planned', detail: `Pod ${m.pod.podName} is assigned. No task has been handed off yet.` };
  return { label: 'Planned', detail: 'No pod or task is assigned yet. Ask the CEO to staff it.' };
}

export function shortDate(iso: string): string {
  // Date-only values (mission targets) are calendar days, not UTC midnight.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
