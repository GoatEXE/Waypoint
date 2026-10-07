

export type ProjectId = string;
export type TaskStatus = 'running' | 'review' | 'done' | 'blocked' | 'queued' | 'decision';
export type RunStatus = 'passed' | 'failed' | 'superseded';
export type SeatStatus = TaskStatus | 'stopped';
export type Status = TaskStatus | RunStatus | 'stopped';

export interface Mission { short: string; title: string; outcome: string; target: string; assignedTo: string; assignedOn: string }
export interface Project { id: ProjectId; name: string; goal: string; repo: string; branch: string; env: string; pod: string; lastDone: string }
export interface TrailStep { from: string; verb: string; to: string; when: string; text: string; msg?: boolean; pending?: boolean }
export interface Message { from: string; to: string; text: string }
export interface Task {
  id: string; p: ProjectId; title: string; st: TaskStatus; owner: string; why: string; deps: string[];
  runs?: string[]; cost?: string; approval?: string; blockedBy?: string; trail?: TrailStep[]; msgs?: Message[];
}
export type DiffLine = [number, ' ' | '+' | '-', string];
export interface ChangedFile { path: string; add: number; del: number; lines: DiffLine[] }
export interface Run {
  task: string; st: RunStatus; when: string; dur: string; tokens: string; cost: string; seat: string; worktree: string;
  short: string; reason: string; summary: string; files: ChangedFile[]; tests: [string, string, string][]; testSum: string;
}
export interface Seat { name: string; role: string; pod: string | null; st: TaskStatus; task: string }
export interface Pod { name: string; template: string; p: ProjectId; uptime: string; learn: { memory: number; skills: number; instr: number } }
export interface InboxItem {
  id: string; kind: string; from: string; when: string; title: string; detail: string; task?: string;
  cta: string; declineLabel?: string; yes: string; no: string; review?: boolean;
}
export type LessonPick = 'seat' | 'project' | 'template' | 'discard';
export interface Lesson { id: string; seat: string; kind: string; ev: string; text: string; sug: LessonPick; flag?: string }
export type ChatEntry =
  | { who: 'you' | 'ceo'; time: string; text: string }
  | { tool: string }
  | { card: string };
export interface Artifact { kind: string; name: string; p: ProjectId; src: string; to: string; img?: boolean }
export interface Routine { id: string; name: string; seat: string; scope: string; schedule: string; lastState: 'ok' | 'warn'; last: string; next: string }
export interface Connector { id: string; name: string; kind: string; on: boolean; detail: string; scope: string }

export const mission: Mission | null = null;
export const projects: Project[] = [];
export const tasks: Task[] = [];
export const runs: Record<string, Run> = {};
export const seats: Seat[] = [];
export const pods: Pod[] = [];
export const inbox: InboxItem[] = [];
export const lessons: Lesson[] = [];
export const chat: ChatEntry[] = [];
export const seatTerminals: Record<string, [string, 'txt' | 'muted' | 'acc' | 'hi'][]> = {};
export const paneArtifacts: Artifact[] = [];
export const allArtifacts: Artifact[] = [];
export const routines: Routine[] = [];
export const connectors: Connector[] = [];
export const podTemplates: { name: string; seats: string; limits: string }[] = [];
