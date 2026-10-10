import type { HermesStatus } from './api';

export type RuntimeCause = 'checking' | 'service' | 'docker' | 'ceo-missing' | 'ceo-stopped' | 'setup' | 'ready';

export interface RuntimeHealth {
  cause: RuntimeCause;
  label: string;
  message: string;
  next: string;
  ready: boolean;
  canStart: boolean;
}

const CAUSES: Record<RuntimeCause, Omit<RuntimeHealth, 'cause'>> = {
  checking: { label: 'Checking CEO…', message: 'Checking the CEO…', next: '', ready: false, canStart: false },
  service: { label: 'Service unreachable', message: "The Waypoint service isn't answering.", next: 'Start it with npm start, then retry.', ready: false, canStart: false },
  docker: { label: 'Docker not running', message: "Docker isn't running.", next: 'Start Docker Desktop, then retry.', ready: false, canStart: false },
  'ceo-missing': { label: 'CEO not created', message: "The CEO hasn't been created yet.", next: 'Start the CEO to create it.', ready: false, canStart: true },
  'ceo-stopped': { label: 'CEO stopped', message: 'The CEO is stopped.', next: 'Start the CEO, then retry.', ready: false, canStart: true },
  setup: { label: 'CEO setup needed', message: 'The CEO needs a model.', next: 'Connect a model in Settings.', ready: false, canStart: false },
  ready: { label: 'CEO ready', message: 'The CEO is running.', next: '', ready: true, canStart: false },
};

export function errorCode(error: unknown): string | null {
  const body = (error as { body?: unknown } | null)?.body;
  const code = body && typeof body === 'object' ? (body as { error?: { code?: unknown } }).error?.code : undefined;
  return typeof code === 'string' ? code : null;
}

export function causeOfError(error: unknown): RuntimeCause | null {
  const code = errorCode(error);
  if (code === 'docker_unavailable') return 'docker';
  if (code === 'ceo_stopped') return 'ceo-stopped';
  if (code === 'control_unavailable' || error instanceof TypeError) return 'service';
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 502 || status === 503 || status === 504) return code ? null : 'service';
  return null;
}

function authReady(status: HermesStatus) {
  const provider = status.model.provider;
  const auth = status.auth?.[provider] || (provider === 'openai-api' ? status.auth?.openai : undefined);
  const verified = Boolean(auth?.ready || auth?.authenticated || auth?.native?.authenticated);
  const unknown = !auth || auth.native?.checked === false || auth.native?.state === 'not_checked';
  return verified ? 'yes' : unknown ? 'unknown' : 'no';
}

export function runtimeCause(status: HermesStatus | null, error: unknown, checked: boolean): RuntimeCause {
  if (!status) return checked ? causeOfError(error) || 'service' : 'checking';
  if (!status.runtime.running) {
    if (status.runtime.state === 'docker_unavailable') return 'docker';
    return status.runtime.state === 'missing' ? 'ceo-missing' : 'ceo-stopped';
  }
  const auth = authReady(status);
  if (status.model.configured && auth === 'yes') return 'ready';
  return auth === 'unknown' ? 'checking' : 'setup';
}

export function runtimeHealth(status: HermesStatus | null, error: unknown, checked: boolean): RuntimeHealth {
  const cause = runtimeCause(status, error, checked);
  return { cause, ...CAUSES[cause] };
}

export function healthFor(cause: RuntimeCause): RuntimeHealth {
  return { cause, ...CAUSES[cause] };
}

export function isRuntimeOutage(cause: RuntimeCause) {
  return cause === 'service' || cause === 'docker' || cause === 'ceo-missing' || cause === 'ceo-stopped';
}

export function errorText(error: unknown): string {
  const cause = causeOfError(error);
  if (cause) return `${CAUSES[cause].message} ${CAUSES[cause].next}`;
  return error instanceof Error ? error.message : String(error);
}

export function rawErrorText(error: unknown): string {
  if (!error) return '';
  const body = (error as { body?: unknown }).body;
  if (body && typeof body === 'object') return JSON.stringify(body);
  return error instanceof Error ? error.message : String(error);
}

export const START_TIMEOUT_MS = 90000;

export function startFailureText(error: unknown, timedOut: boolean): string {
  if (timedOut) return "The CEO didn't start within 90 seconds. Check that Docker Desktop is running, then retry.";
  const cause = causeOfError(error);
  if (cause === 'docker') return "Docker isn't running. Start Docker Desktop, then retry.";
  if (cause === 'service') return "The Waypoint service isn't answering. Start it with npm start, then retry.";
  return `The CEO couldn't start: ${error instanceof Error ? error.message : String(error)}`;
}

export function mergeStatus(previous: HermesStatus | null, next: HermesStatus): HermesStatus {
  if (!previous?.runtime.running || !next.runtime.running) return next;
  const auth = { ...next.auth };
  for (const [provider, value] of Object.entries(next.auth || {})) {
    const before = previous.auth?.[provider];
    if (value.native?.checked === false && before?.native?.checked) auth[provider] = before;
  }
  return { ...next, auth };
}
