import type { HermesLogin, HermesStatus } from './api';
import type { Provider } from './settingsModel';

const CONNECTOR_PROVIDERS = new Set<string>(['openai-codex', 'anthropic', 'openai-api']);

export function toConnectorProvider(value: string): Provider | null {
  return CONNECTOR_PROVIDERS.has(value) ? value as Provider : null;
}

export function isActiveLogin(login: HermesLogin | null): boolean {
  return login?.state === 'pending' || login?.state === 'cancelling';
}

export function shouldShowLoginPromptMaterial(login: HermesLogin | null): boolean {
  return login?.state === 'pending' || login?.state === 'cancelling';
}

export function shouldClearLoginPrompt(login: HermesLogin | null): boolean {
  return login?.state === 'authorized';
}

export function statusHasUncheckedNativeAuth(status: HermesStatus | null): boolean {
  if (!status?.runtime.running) return false;
  return ['openai-codex', 'anthropic', 'openai-api'].some(provider => status.auth?.[provider]?.native?.state === 'not_checked');
}

export function isMissingLoginError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /login not found|not_found/i.test(message);
}

export function shouldApplyMissingLoginRecovery(active: HermesLogin | null, missing: HermesLogin): boolean {
  return active?.id === missing.id;
}
