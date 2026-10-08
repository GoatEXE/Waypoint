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
export interface CeoMessage { role: 'user' | 'ceo' | 'seat' | 'activity'; text?: string; at: string; status?: 'sent' | 'confirmed' | 'outcome_unknown'; items?: ActivityItem[] }
export interface CeoLiveTurn { startedAt: string; message: string; items: ActivityItem[] }
export interface CeoConversation { threadId?: string; sessionId: string | null; messages: CeoMessage[]; live?: CeoLiveTurn | null; busyThreadId?: string | null }
export interface CeoSendResponse extends CeoConversation { sessionId: string; reply: string }
export interface CeoThread { threadId: string; title: string; ref: string | null; status: TaskStatus | null; messageCount: number; updatedAt: string | null; lastText: string }

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

export function parseSeatThread(threadId: string): { podId: string; seatId: string } | null {
  const match = /^seat:(pod_[^/]+)\/([a-z][a-z0-9_-]*)$/.exec(threadId);
  return match ? { podId: match[1], seatId: match[2] } : null;
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
  threadConversation: (threadId: string) => {
    const seat = parseSeatThread(threadId);
    return seat ? json<CeoConversation>(`/pod-instances/${encodeURIComponent(seat.podId)}/seats/${encodeURIComponent(seat.seatId)}/conversation`) : api.ceoConversation(threadId);
  },
  sendThreadMessage: (message: string, threadId: string) => {
    const seat = parseSeatThread(threadId);
    return seat ? json<CeoSendResponse>(`/pod-instances/${encodeURIComponent(seat.podId)}/seats/${encodeURIComponent(seat.seatId)}/messages`, { method: 'POST', body: JSON.stringify({ message }) }) : api.sendCeoMessage(message, threadId);
  },
  ceoThreads: () => json<{ threads: CeoThread[]; busyThreadId: string | null }>('/hermes/ceo/threads'),
  sendCeoMessage: (message: string, threadId = 'general') => json<CeoSendResponse>('/hermes/ceo/messages', { method: 'POST', body: JSON.stringify({ message, threadId }) }),
  missions: () => json<{ missions: Mission[] }>('/missions'),
  orgChart: () => json<{ pods: { podId: string; name: string; state: string; seats: { seatId: string; role: string }[] }[] }>('/org-chart'),
  tasks: () => json<{ tasks: TaskSummary[] }>('/tasks'),
  messageDeliveries: () => json<{ messages: MessageDelivery[] }>('/message-deliveries'),
  reviewMessageDelivery: (to: string, messageId: string) => json<{ id: string; to: string; reviewedAt: string; wakeState: string }>('/message-deliveries/review', { method: 'POST', body: JSON.stringify({ to, messageId }) }),
  createMission: (body: MissionInput) => json<Mission>('/missions', { method: 'POST', body: JSON.stringify(body) }),
  deleteMission: (id: string) => json<{ deleted: true; missionId: string; podId: string | null; taskId: string | null }>(`/missions/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' }),
  podInstance: (id: string) => json<PodInstance>(`/pod-instances/${encodeURIComponent(id)}`),
  podLifecycle: (id: string, action: 'start' | 'stop' | 'status') => json<PodLifecycleResponse>(`/pod-instances/${encodeURIComponent(id)}/lifecycle`, { method: 'POST', body: JSON.stringify({ action }) }),
  podSeatStatus: (id: string, options: { seatIds?: string[]; skipAuth?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.seatIds?.length) params.set('seatIds', options.seatIds.join(','));
    if (options.skipAuth) params.set('auth', 'skip');
    const query = params.toString();
    return json<PodSeatStatusResponse>(`/pod-instances/${encodeURIComponent(id)}/seats/status${query ? `?${query}` : ''}`);
  },
  provisionPodSeats: (id: string, seatIds?: string[]) => json<PodSeatStatusResponse>(`/pod-instances/${encodeURIComponent(id)}/seats/provision`, { method: 'POST', body: JSON.stringify(seatIds?.length ? { seatIds } : {}) }),
  saveSeatModel: (podId: string, seatId: string, model: SeatModel | null) => json<SeatModelSaveResponse>(`/pod-instances/${encodeURIComponent(podId)}/seats/${encodeURIComponent(seatId)}/model`, { method: 'PUT', body: JSON.stringify({ model }) }),
  startSeatLogin: (podId: string, seatId: string, provider: string, flow?: string) => json<PodSeatLogin>(`/pod-instances/${encodeURIComponent(podId)}/seats/${encodeURIComponent(seatId)}/providers/${encodeURIComponent(provider)}/login`, { method: 'POST', body: JSON.stringify({ ...(flow ? { flow } : {}) }) }),
  getSeatLogin: (podId: string, seatId: string, provider: string, loginId: string) => json<PodSeatLogin>(`/pod-instances/${encodeURIComponent(podId)}/seats/${encodeURIComponent(seatId)}/providers/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`),
  submitSeatLoginCode: (podId: string, seatId: string, provider: string, loginId: string, code: string) => json<PodSeatLogin>(`/pod-instances/${encodeURIComponent(podId)}/seats/${encodeURIComponent(seatId)}/providers/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}/code`, { method: 'POST', body: JSON.stringify({ code }) }),
  cancelSeatLogin: (podId: string, seatId: string, provider: string, loginId: string) => json<PodSeatLogin>(`/pod-instances/${encodeURIComponent(podId)}/seats/${encodeURIComponent(seatId)}/providers/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`, { method: 'DELETE', body: JSON.stringify({}) }),
  saveSeatApiKey: (podId: string, seatId: string, provider: string, apiKey: string) => json<PodSeatApiKeyResponse>(`/pod-instances/${encodeURIComponent(podId)}/seats/${encodeURIComponent(seatId)}/providers/${encodeURIComponent(provider)}/api-key`, { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  task: (id: string) => json<TaskRecord>(`/tasks/${encodeURIComponent(id)}`),
  taskMessages: (id: string) => json<{ messages: MessageDelivery[] }>(`/tasks/${encodeURIComponent(id)}/messages`),
  createTask: (body: TaskInput) => json<TaskRecord>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: TaskInput) => json<TaskRecord>(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  projects: () => json<{ projects: Project[] }>('/projects'),
  updateProject: (id: string, body: Partial<Pick<Project, 'name' | 'missionId' | 'workspace' | 'localPath' | 'repo' | 'githubSeats'>>) => json<Project & { pods?: { updated: string[]; pending: string[] }; toolsInstalled?: string[] }>(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProject: (id: string) => json<{ deleted: true; projectId: string }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' }),
  pickFolder: (start: string) => json<{ path: string | null; cancelled: boolean }>('/folders/pick', { method: 'POST', body: JSON.stringify({ start }) }),
  inspectLocalPath: (localPath: string) => json<LocalRepoInfo>('/projects/inspect', { method: 'POST', body: JSON.stringify({ localPath }) }),
  githubStatus: (fresh = false) => json<GitHubStatus>(`/github${fresh ? '?fresh=1' : ''}`),
  githubManifest: (origin: string, owner: string) => json<{ state: string; url: string; manifest: object }>('/github/manifest', { method: 'POST', body: JSON.stringify({ origin, owner }) }),
  githubComplete: (code: string, state: string) => json<GitHubStatus>('/github/complete', { method: 'POST', body: JSON.stringify({ code, state }) }),
  githubDisconnect: () => json<{ connected: false }>('/github', { method: 'DELETE', body: '{}' }),
  createProject: (body: { name: string; missionId?: string | null; workspace?: ProjectWorkspace; localPath?: string | null; repo?: string | null }) => json<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  runTask: (id: string) => json<TaskRunStartResponse>(`/tasks/${encodeURIComponent(id)}/run`, { method: 'POST', body: JSON.stringify({}) }),
  retryTaskAfterReview: (id: string) => json<TaskRunStartResponse>(`/tasks/${encodeURIComponent(id)}/manual-retry`, { method: 'POST', body: JSON.stringify({ reviewed: true }) }),
};

export interface Organization { name: string; key: string; ceoName: string; logo: string | null; createdAt: string; updatedAt: string }
export interface OrganizationState { configured: boolean; organization: Organization | null }
export type OrganizationInput = Partial<Pick<Organization, 'name' | 'key' | 'ceoName' | 'logo'>>
export interface AppConfig { dryRun: boolean; serviceName?: string; sharedAuth?: { enabled: boolean }; docker?: { imageConfigured?: boolean; imagePinned?: boolean }; hermes?: { imagePinned?: boolean } }
export interface MissionEvidence { type: string; message: string; at: string }
export interface MissionPod { id: string; podName: string; templateId: string; state: string; seats: { id: string; role: string }[] }
export interface MissionTask { id: string; podId: string; seatId: string; summary: string; state: string; evidence: MissionEvidence[]; updatedAt: string }
export interface Mission {
  id: string;
  title: string;
  outcome: string;
  target: string;
  podId: string | null;
  taskId: string | null;
  state: 'planned' | 'delegated';
  source: 'ceo' | 'app';
  createdAt: string;
  updatedAt: string;
  pod: MissionPod | null;
  task: MissionTask | null;
  missing: ('pod' | 'task')[];
}
export interface MissionInput { title: string; outcome?: string; target?: string }
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled';
export interface TaskSummary {
  id: string;
  number: number | null;
  ref: string | null;
  summary: string;
  description: string;
  status: TaskStatus;
  state: string;
  podId: string | null;
  seatId: string | null;
  projectId: string | null;
  labels: string[];
  parentId: string | null;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}
export interface StatusChange { from: TaskStatus | null; to: TaskStatus; by: 'user' | 'ceo' | 'system'; at: string; reason?: string }
export interface TaskInput { summary?: string; description?: string; status?: TaskStatus; podId?: string | null; seatId?: string | null; projectId?: string | null; labels?: string[]; parentId?: string | null; blockedBy?: string[] }
export type ProjectWorkspace = 'local' | 'pod';
export interface Project { id: string; name: string; missionId?: string | null; workspace?: ProjectWorkspace; localPath?: string | null; repo?: string | null; githubSeats?: string[]; createdAt: string; updatedAt: string }
export interface LocalRepoInfo { localPath: string; exists: boolean; isGit: boolean; root: string | null; remote: string | null; repo: string | null; branch: string | null }
export interface GitHubStatus { connected: boolean; app: { appId: number; slug: string; name: string; htmlUrl: string; owner: string | null } | null; installUrl: string | null; installations: { id: number; account: string; selection: string; repos: string[] }[]; error?: string | null }
export interface MessageDelivery {
  id: string;
  from: string;
  to: string;
  text: string;
  taskId?: string | null;
  createdAt: string;
  readAt: string | null;
  wake: { state: string; depth: number; attempts: number; startedAt?: string; finishedAt?: string; reason?: string; nextAttemptAt?: string } | null;
}

export interface SeatModel { provider: string; default: string; api_mode?: string; base_url?: string }
export interface PodInstanceSeat { id: string; role: string; state?: string; copiedFiles?: string[]; model?: SeatModel }
export interface PodInstance {
  id: string;
  podName: string;
  templateId: string;
  templateVersion?: string;
  state: string;
  seats: PodInstanceSeat[];
  lifecycle?: { lastAction?: string; dryRun?: boolean; executed?: boolean; status?: { state?: string; running?: boolean; id?: string }; updatedAt?: string };
  createdAt?: string;
}
export interface PodLifecycleResponse { action?: string; dryRun?: boolean; executed?: boolean; message?: string; status?: { state?: string; running?: boolean; id?: string } }
export interface PodSeatModelView { state: string; source?: string; requested?: SeatModel | null; current?: { provider?: string; default?: string; apiMode?: string; baseUrlSet?: boolean } | null }
export interface PodSeatAuthProvider { checked?: boolean; authenticated?: boolean; state?: string; message?: string }
export interface PodSeatStatus {
  seatId: string;
  ready: boolean;
  blockers: string[];
  profile: { state: string; identity?: boolean; writable?: boolean; envPrivate?: boolean; missingSubdirs?: string[]; changed?: string[] } | null;
  model: PodSeatModelView;
  auth: { providers: Record<string, PodSeatAuthProvider>; seatAuthFile?: boolean; podAuthFile?: boolean } | null;
}
export interface PodSeatStatusResponse { podId: string; action?: string; dryRun?: boolean; executed?: boolean; changed?: boolean; ready?: boolean; seats: PodSeatStatus[]; notes?: string[] }
export interface SeatModelSaveResponse { podId: string; podName: string; seat: { id: string; role: string; model: SeatModel | null } }
export interface PodSeatLogin {
  id: string;
  podId: string;
  seatId: string;
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
export interface PodSeatApiKeyResponse { podId: string; seatId: string; provider: string; configured: boolean; credentialPresent: boolean; authMode: string; message: string }
export interface TaskRunRecord {
  id: string;
  state: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number | null;
  reason?: string | null;
  reply?: string;
  replyTruncated?: boolean;
  activity?: ActivityItem[];
  fromState?: string;
  manualRetry?: boolean;
}
export interface TaskRecord extends TaskSummary {
  liveActivity?: { runId: string; items: ActivityItem[] } | null;
  activeRunId?: string;
  lastRunId?: string;
  runs?: TaskRunRecord[];
  statusHistory?: StatusChange[];
  evidence: (MissionEvidence & { runId?: string; retry?: string })[];
  createdAt: string;
  updatedAt: string;
}
export interface TaskRunStartResponse {
  taskId: string;
  runId?: string;
  state: string;
  dryRun?: boolean;
  executed?: boolean;
  message?: string;
}
