import type { TaskSummary } from './api';

export interface OrgChartData {
  ceo: { address: string; name: string; role: string } | null;
  pods: { podId: string; name: string; state: string; seats: { seatId: string; role: string }[] }[];
}

export interface SeatNode { seatId: string; role: string; open: TaskSummary[]; running: TaskSummary | null }
export interface PodNode { podId: string; name: string; state: string; seats: SeatNode[]; podOnly: TaskSummary[]; openCount: number; runningCount: number }
export interface OrgTree { pods: PodNode[]; unassigned: TaskSummary[] }

export function isOpen(task: TaskSummary) {
  return task.status !== 'done' && task.status !== 'canceled';
}

export function buildOrgTree(chart: OrgChartData, tasks: TaskSummary[]): OrgTree {
  const open = tasks.filter(isOpen).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const pods = chart.pods.map(pod => {
    const podTasks = open.filter(t => t.podId === pod.podId);
    const seats = pod.seats.map(seat => {
      const seatTasks = podTasks.filter(t => t.seatId === seat.seatId);
      return { seatId: seat.seatId, role: seat.role, open: seatTasks, running: seatTasks.find(t => t.state === 'running') || null };
    });
    const knownSeats = new Set(pod.seats.map(s => s.seatId));
    return {
      podId: pod.podId,
      name: pod.name,
      state: pod.state,
      seats,
      podOnly: podTasks.filter(t => !t.seatId || !knownSeats.has(t.seatId)),
      openCount: podTasks.length,
      runningCount: podTasks.filter(t => t.state === 'running').length,
    };
  });
  const podIds = new Set(chart.pods.map(p => p.podId));
  return { pods, unassigned: open.filter(t => !t.podId || !podIds.has(t.podId)) };
}
