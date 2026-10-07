import type { HermesStatus } from './api';

export interface SidebarHermesSummary { label: string; ready: boolean }

function authForCurrentProvider(status: HermesStatus) {
  const provider = status.model.provider;
  return status.auth?.[provider] || (provider === 'openai-api' ? status.auth?.openai : undefined);
}

export function sidebarHermesSummary(status: HermesStatus | null, checked: boolean): SidebarHermesSummary {
  if (!status) return { label: checked ? 'Backend disconnected' : 'Checking CEO…', ready: false };
  if (!status.runtime.running) return { label: `Hermes CEO ${status.runtime.state || 'unavailable'}`, ready: false };

  const auth = authForCurrentProvider(status);
  const authVerified = Boolean(auth?.ready || auth?.authenticated || auth?.native?.authenticated);
  const authUnknown = !auth || auth.native?.checked === false || auth.native?.state === 'not_checked';

  if (status.model.configured && authVerified) return { label: 'Hermes CEO ready', ready: true };
  if (authUnknown) return { label: 'Checking CEO…', ready: false };
  return { label: 'Hermes CEO setup needed', ready: false };
}
