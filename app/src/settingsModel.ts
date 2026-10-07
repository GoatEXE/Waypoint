import type { HermesModelProviderCatalog, HermesStatus } from './api';

export type Provider = 'openai-codex' | 'anthropic' | 'openai-api';
export type ModelState = { provider: Provider; default: string; base_url: string; api_mode: string };

export const DEFAULTS: Record<Provider, { default: string; api_mode: string }> = {
  'openai-codex': { default: 'gpt-6-sol', api_mode: 'codex_responses' },
  anthropic: { default: 'claude-fable-5.1', api_mode: 'anthropic_messages' },
  'openai-api': { default: 'gpt-6-sol', api_mode: 'codex_responses' },
};

export function toProvider(value?: string): Provider {
  if (value === 'openai') return 'openai-api';
  return value === 'openai-codex' || value === 'anthropic' || value === 'openai-api' ? value : 'openai-codex';
}

export function modelFromStatus(status: HermesStatus): ModelState | null {
  if (!status.model?.configured) return null;
  const provider = toProvider(status.model.provider);
  return {
    provider,
    default: status.model.default || DEFAULTS[provider].default,
    base_url: status.model.base_url || '',
    api_mode: status.model.api_mode || DEFAULTS[provider].api_mode,
  };
}

export function applySavedModelIfClean(current: ModelState, status: HermesStatus, dirty: boolean): ModelState {
  const saved = modelFromStatus(status);
  if (!saved || dirty) return current;
  return saved;
}

export function defaultModelForProvider(provider: Provider, catalogProvider?: HermesModelProviderCatalog, recommendedIds: readonly string[] = []): string {
  const listed = catalogProvider?.models || [];
  const byId = new Map(listed.map(m => [m.id, m]));
  const recommended = recommendedIds.flatMap(id => {
    const model = byId.get(id);
    return model ? [model] : [];
  });
  if (catalogProvider?.default && recommended.some(m => m.id === catalogProvider.default)) return catalogProvider.default;
  return recommended[0]?.id || catalogProvider?.default || DEFAULTS[provider].default;
}
