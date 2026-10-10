export interface HermesStatus {
  image: string;
  imagePinned: boolean;
  containerName: string;
  volumeName: string;
  runtime: { state: string; running: boolean; id?: string };
  model: { configured: boolean; provider: string; default: string; base_url?: string; api_mode?: string };
  auth: Record<string, { credentialPresent: boolean; oauthPresent: boolean; apiKeyPresent: boolean; authenticated: boolean; ready: boolean; native?: { checked: boolean; authenticated: boolean; state: string; message: string } }>;
  diagnostics?: { configAvailable: boolean; message: string };
  dashboard?: { enabled: boolean; note?: string };
}

export interface HermesModelOption { id: string; name: string; source?: string; note?: string }
export interface HermesModelProviderCatalog {
  id: string;
  label: string;
  nativeProvider: string;
  default: string;
  api_mode: string;
  source: string;
  models: HermesModelOption[];
}
export interface HermesModelCatalog {
  providers: HermesModelProviderCatalog[];
  diagnostics: { available: boolean; source: string; message: string };
}

export interface HermesLogin {
  id: string;
  provider: string;
  flow: string;
  state: 'pending' | 'cancelling' | 'authorized' | 'failed' | 'cancelled';
  authUrl: string;
  userCode: string;
  requiresCode: boolean;
  startedAt: string;
  updatedAt: string;
  message: string;
}

export type HermesSkillSource = 'builtin' | 'local' | 'hub';
export interface HermesSkill {
  name: string;
  description: string;
  category: string;
  source: HermesSkillSource;
  enabled: boolean;
  locked: boolean;
  waypoint?: boolean;
}
export interface HermesSkillInventory {
  available: boolean;
  runtime: { state: string; running: boolean };
  skills: HermesSkill[];
  counts: { total: number; enabled: number; disabled: number; builtin: number; local: number; hub: number; waypoint?: number; added?: number };
  message?: string;
  checkedAt?: string;
}
export type HermesSkillUpdateResponse = HermesSkill | { skill: HermesSkill };

export interface ActivityItem { kind: 'tool' | 'action'; name: string; detail: string; status: 'running' | 'ok' | 'error' | 'unknown'; durationMs?: number; at?: string }
export interface CeoMessage { role: 'user' | 'ceo' | 'activity'; text?: string; at: string; status?: 'sent' | 'confirmed' | 'outcome_unknown'; items?: ActivityItem[] }
export interface CeoLiveTurn { startedAt: string; message: string; items: ActivityItem[] }
export interface CeoConversation { threadId?: string; sessionId: string | null; messages: CeoMessage[]; live?: CeoLiveTurn | null; busyThreadId?: string | null }
export interface CeoSendResponse extends CeoConversation { sessionId: string; reply: string }
export interface CeoThread { threadId: string; title: string; ref: string | null; status: BoardStatus | null; messageCount: number; updatedAt: string | null; lastText: string }

const inflightGets = new Map<string, Promise<unknown>>();

function parseBody(raw: string): unknown {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return raw; }
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function responseError(body: unknown, status: number) {
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object') {
    const record = body as { error?: unknown; message?: unknown };
    if (typeof record.error === 'string') return record.error;
    if (record.error && typeof record.error === 'object' && typeof (record.error as { message?: unknown }).message === 'string') return (record.error as { message: string }).message;
    if (typeof record.message === 'string') return record.message;
  }
  return `Request failed (${status})`;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method || 'GET';
  if (method === 'GET' && inflightGets.has(path)) return inflightGets.get(path) as Promise<T>;
  const request = (async () => {
    const res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    });
    const body = parseBody(await res.text().catch(() => ''));
    if (!res.ok) throw new ApiError(responseError(body, res.status), res.status, body);
    return body as T;
  })();
  if (method === 'GET') {
    inflightGets.set(path, request);
    request.then(() => inflightGets.delete(path), () => inflightGets.delete(path));
  }
  return request;
}

export const api = {
  config: () => json<AppConfig>('/config'),
  organization: () => json<OrganizationState>('/organization'),
  saveOrganization: (body: OrganizationInput) => json<OrganizationState>('/organization', { method: 'PUT', body: JSON.stringify(body) }),
  hermesStatus: (options: { freshAuth?: boolean } = {}) => json<HermesStatus>(`/hermes/status${options.freshAuth ? '?nativeAuth=fresh' : ''}`),
  hermesModelCatalog: (provider?: string, options: { refresh?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (provider) params.set('provider', provider);
    if (options.refresh) params.set('refresh', '1');
    const query = params.toString();
    return json<HermesModelCatalog>(`/hermes/model-catalog${query ? `?${query}` : ''}`);
  },
  hermesLifecycle: (action: 'start' | 'stop' | 'status') => json('/hermes/lifecycle', { method: 'POST', body: JSON.stringify({ action }) }),
  saveModel: (body: { provider: string; default: string; base_url?: string; api_mode?: string }) => json<{ saved: true; model: typeof body }>('/hermes/model', { method: 'PUT', body: JSON.stringify(body) }),
  saveApiKey: (provider: string, apiKey: string) => json<{ provider: string; configured: boolean; authMode: string }>(`/hermes/providers/${encodeURIComponent(provider)}/api-key`, { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  startLogin: (provider: string, flow?: string) => json<HermesLogin>(`/hermes/providers/${encodeURIComponent(provider)}/login`, { method: 'POST', body: JSON.stringify({ flow }) }),
  getLogin: (provider: string, id: string) => json<HermesLogin>(`/hermes/providers/${encodeURIComponent(provider)}/login/${encodeURIComponent(id)}`),
  submitLoginCode: (provider: string, id: string, code: string) => json<HermesLogin>(`/hermes/providers/${encodeURIComponent(provider)}/login/${encodeURIComponent(id)}/code`, { method: 'POST', body: JSON.stringify({ code }) }),
  cancelLogin: (provider: string, id: string) => json<HermesLogin>(`/hermes/providers/${encodeURIComponent(provider)}/login/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({}) }),
  hermesSkills: () => json<HermesSkillInventory>('/hermes/skills'),
  setHermesSkillEnabled: (name: string, enabled: boolean) => json<HermesSkillUpdateResponse>(`/hermes/skills/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  ceoConversation: (threadId = 'general') => json<CeoConversation>(`/hermes/ceo/conversation?threadId=${encodeURIComponent(threadId)}`),
  ceoThreads: () => json<{ threads: CeoThread[]; busyThreadId: string | null }>('/hermes/ceo/threads'),
  sendCeoMessage: (message: string, threadId = 'general') => json<CeoSendResponse>('/hermes/ceo/messages', { method: 'POST', body: JSON.stringify({ message, threadId }) }),
  missions: () => json<{ missions: Mission[] }>('/missions'),
  tasks: () => json<{ tasks: BoardTask[] }>('/tasks'),
  createMission: (body: MissionInput) => json<Mission>('/missions', { method: 'POST', body: JSON.stringify(body) }),
  updateMission: (id: string, status: MissionStatus) => json<Mission>(`/missions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  pods: () => json<{ pods: Pod[] }>('/pods'),
  pod: (name: string) => json<Pod & { tasks: BoardTask[] }>(`/pods/${encodeURIComponent(name)}`),
  podConversation: (name: string) => json<{ pod: string; entries: PodEntry[] }>(`/pods/${encodeURIComponent(name)}/conversation`),
  createPod: (body: { name: string; purpose?: string; seats: string[]; durable?: boolean }) => json<Pod>('/pods', { method: 'POST', body: JSON.stringify(body) }),
  reviewLearning: (name: string) => json<Pod>(`/pods/${encodeURIComponent(name)}/learning`, { method: 'POST', body: '{}' }),
  decideLearning: (name: string, id: string, decision: 'apply' | 'drop') => json<Pod>(`/pods/${encodeURIComponent(name)}/learning/${id}`, { method: 'POST', body: JSON.stringify({ decision }) }),
  closePod: (name: string) => json<Pod>(`/pods/${encodeURIComponent(name)}/close`, { method: 'POST', body: '{}' }),
  orgSeats: () => json<{ seats: OrgSeat[] }>('/org/seats'),
  hireSeat: (body: { id: string; description: string; cloneFrom?: string }) => json<{ seat: OrgSeat }>('/org/seats', { method: 'POST', body: JSON.stringify(body) }),
  hermesPortal: () => json<HermesPortalStatus>('/hermes-portal'),
  openHermesPortal: (target: string) => json<HermesPortalStatus & { url: string }>('/hermes-portal', { method: 'POST', body: JSON.stringify({ target }) }),
  closeHermesPortal: () => json<HermesPortalStatus>('/hermes-portal', { method: 'DELETE', body: '{}' }),
  deleteMission: (id: string) => json<{ deleted: true; missionId: string }>(`/missions/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' }),
  task: (ref: string) => json<BoardTaskDetail>(`/tasks/${encodeURIComponent(ref)}`),
  createTask: (body: { title: string; body?: string; assignee?: string | null; parents?: string[]; board?: string }) => json<BoardTaskDetail>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  commentTask: (ref: string, text: string) => json<BoardTaskDetail>(`/tasks/${encodeURIComponent(ref)}/comments`, { method: 'POST', body: JSON.stringify({ text }) }),
  taskAction: (ref: string, body: { action: 'complete' | 'archive' | 'block' | 'unblock' | 'assign'; assignee?: string | null; reason?: string; summary?: string }) => json<BoardTaskDetail>(`/tasks/${encodeURIComponent(ref)}/actions`, { method: 'POST', body: JSON.stringify(body) }),
  projects: () => json<{ projects: Project[] }>('/projects'),
  updateProject: (id: string, body: Partial<Pick<Project, 'name' | 'missionId' | 'repo'>>) => json<Project>(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProject: (id: string) => json<{ deleted: true; projectId: string }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' }),
  githubStatus: (fresh = false) => json<GitHubStatus>(`/github${fresh ? '?fresh=1' : ''}`),
  githubManifest: (origin: string, owner: string) => json<{ state: string; url: string; manifest: object }>('/github/manifest', { method: 'POST', body: JSON.stringify({ origin, owner }) }),
  githubComplete: (code: string, state: string) => json<GitHubStatus>('/github/complete', { method: 'POST', body: JSON.stringify({ code, state }) }),
  githubDisconnect: () => json<{ connected: false }>('/github', { method: 'DELETE', body: '{}' }),
  createProject: (body: { name: string; missionId?: string | null; repo?: string | null }) => json<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
};

export interface Organization { name: string; key: string; ceoName: string; logo: string | null; createdAt: string; updatedAt: string }
export interface OrganizationState { configured: boolean; organization: Organization | null }
export type OrganizationInput = Partial<Pick<Organization, 'name' | 'key' | 'ceoName' | 'logo'>>
export interface AppConfig { dryRun: boolean; serviceName?: string; sharedAuth?: { enabled: boolean }; docker?: { imageConfigured?: boolean; imagePinned?: boolean }; hermes?: { imagePinned?: boolean } }
export type MissionStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled';
export interface Mission {
  id: string;
  title: string;
  outcome: string;
  target: string | null;
  taskId: string | null;
  status: MissionStatus;
  source: 'ceo' | 'app';
  createdAt: string;
  updatedAt: string;
}
export interface MissionInput { title: string; outcome?: string; target?: string }
export type BoardStatus = 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'review' | 'done' | 'archived';
export interface BoardTask {
  id: string;
  board: string;
  number: number | null;
  ref: string | null;
  title: string;
  body: string;
  status: BoardStatus;
  assignee: string | null;
  createdBy: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}
export interface BoardTaskLink { id: string; ref: string | null; title: string; status: BoardStatus | null; assignee: string | null }
export interface BoardComment { author: string; body: string; at: string | null }
export interface BoardEvent { kind: string; at: string | null; runId: number | null; detail: string }
export interface BoardTaskDetail extends BoardTask {
  latestSummary: string;
  parents: BoardTaskLink[];
  children: BoardTaskLink[];
  comments: BoardComment[];
  events: BoardEvent[];
}
export interface Project { id: string; name: string; missionId?: string | null; repo?: string | null; createdAt: string; updatedAt: string }
export interface GitHubStatus { connected: boolean; app: { appId: number; slug: string; name: string; htmlUrl: string; owner: string | null } | null; installUrl: string | null; installations: { id: number; account: string; selection: string; repos: string[] }[]; error?: string | null }
export interface PodSeat { id: string; from: string; description: string }
export interface LearningItem { id: string; seat: string; from: string; kind: 'skill' | 'memory'; path: string; change: 'added' | 'modified'; text: string; decision: 'apply' | 'drop' | null }
export interface Pod { name: string; slug: string; purpose: string; durable: boolean; status: 'active' | 'closed'; seats: PodSeat[]; createdAt: string; closedAt: string | null; seatsRemoved?: boolean; learning?: { computedAt: string; reviewedAt?: string; items: LearningItem[] } }
export const pendingLearning = (pod: Pod) => (pod.learning?.items || []).filter(item => !item.decision).length;
export interface PodEntry { at: string; kind: 'task' | 'comment' | 'review_requested' | 'completed' | 'blocked'; author: string | null; to?: string | null; text: string; ref: string | null; title: string }
export interface OrgSeat { id: string; description: string; model: string; provider: string }
export interface HermesPortalStatus { open: boolean; target: string | null; url: string | null; openedAt: string | null }
