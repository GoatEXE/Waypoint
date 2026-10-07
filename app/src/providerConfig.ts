import type { HermesStatus } from './api';
import type { Provider } from './settingsModel';

export const PROVIDERS: { id: Provider; name: string; auth: string; note: string; keyFallback?: boolean; loginFlow?: 'device' | 'authorization-code' }[] = [
  { id: 'openai-codex', name: 'OpenAI Codex', auth: 'OpenAI account', note: 'Sign in with your OpenAI account.', loginFlow: 'device' },
  { id: 'anthropic', name: 'Anthropic Claude', auth: 'Claude account or API key', note: 'Sign in with Claude or use an API key.', keyFallback: true, loginFlow: 'authorization-code' },
  { id: 'openai-api', name: 'OpenAI API', auth: 'API key', note: 'Use an OpenAI API key.', keyFallback: true },
];

export const RECOMMENDED_MODELS: Record<Provider, string[]> = {
  'openai-codex': ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.3-codex-spark'],
  anthropic: ['claude-opus-5-5', 'claude-fable-5.1', 'claude-sonnet-5', 'claude-opus-5'],
  'openai-api': ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-4o'],
};

export function authForProvider(status: HermesStatus | null, provider: Provider) {
  return status?.auth?.[provider] || (provider === 'openai-api' ? status?.auth?.openai : undefined);
}

export function providerReadiness(status: HermesStatus | null, provider: Provider) {
  const auth = authForProvider(status, provider);
  if (!status) return { label: 'Unknown', on: false };
  if (!status.runtime.running) return { label: status.runtime.state === 'missing' ? 'Container missing' : 'Stopped', on: false };
  if (auth?.authenticated) return { label: 'Signed in', on: true };
  if (auth?.credentialPresent) return { label: 'Credential saved', on: false };
  if (auth?.native?.state === 'not_checked') return { label: 'Status not checked', on: false };
  return { label: 'Not connected', on: false };
}
