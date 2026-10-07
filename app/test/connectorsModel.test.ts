import test from 'node:test';
import assert from 'node:assert/strict';
import { isMissingLoginError, shouldApplyMissingLoginRecovery, shouldClearLoginPrompt, shouldShowLoginPromptMaterial, statusHasUncheckedNativeAuth } from '../src/connectorsModel.ts';
import type { HermesLogin, HermesStatus } from '../src/api.ts';

function login(provider: string, state: HermesLogin['state']): HermesLogin {
  return { id: 'login-1', provider, flow: 'device', state, authUrl: 'https://example.invalid/auth', userCode: 'CODE-EXAMPLE', requiresCode: false, startedAt: '', updatedAt: '', message: 'status' };
}

function status(authenticatedProvider = '', options: { unchecked?: boolean } = {}): HermesStatus {
  const auth = {
    'openai-codex': { credentialPresent: false, oauthPresent: false, apiKeyPresent: false, authenticated: false, ready: false },
    anthropic: { credentialPresent: false, oauthPresent: false, apiKeyPresent: false, authenticated: false, ready: false },
    'openai-api': { credentialPresent: false, oauthPresent: false, apiKeyPresent: false, authenticated: false, ready: false },
    openai: { credentialPresent: false, oauthPresent: false, apiKeyPresent: false, authenticated: false, ready: false },
  } as HermesStatus['auth'];
  if (authenticatedProvider) auth[authenticatedProvider] = { ...auth[authenticatedProvider], authenticated: true, ready: true, credentialPresent: true, oauthPresent: true };
  if (options.unchecked) auth['openai-codex'] = { ...auth['openai-codex'], native: { checked: false, authenticated: false, state: 'not_checked', message: 'not checked' } };
  return {
    image: 'img',
    imagePinned: true,
    containerName: 'waypoint-hermes-ceo',
    volumeName: 'waypoint-hermes-ceo-home',
    runtime: { state: 'running', running: true },
    model: { configured: false, provider: '', default: '' },
    auth,
  };
}

test('only an authorized login clears the prompt and terminal prompts stop showing URL/code material', () => {
  assert.equal(shouldClearLoginPrompt(login('openai-codex', 'authorized')), true);
  assert.equal(shouldClearLoginPrompt(login('openai-codex', 'failed')), false);
  assert.equal(shouldClearLoginPrompt(login('openai-codex', 'cancelled')), false);
  assert.equal(shouldShowLoginPromptMaterial(login('openai-codex', 'authorized')), false);
  assert.equal(shouldShowLoginPromptMaterial(login('openai-codex', 'failed')), false);
  assert.equal(shouldShowLoginPromptMaterial(login('openai-codex', 'cancelled')), false);
});

test('pending and cancelling prompts stay visible even when status says provider is authenticated', () => {
  const authenticated = status('openai-codex');
  assert.equal(authenticated.auth['openai-codex'].authenticated, true);
  assert.equal(shouldClearLoginPrompt(login('openai-codex', 'pending')), false);
  assert.equal(shouldClearLoginPrompt(login('openai-codex', 'cancelling')), false);
  assert.equal(shouldShowLoginPromptMaterial(login('openai-codex', 'pending')), true);
  assert.equal(shouldShowLoginPromptMaterial(login('openai-codex', 'cancelling')), true);
});

test('unchecked native auth status is detected for background fresh checks', () => {
  assert.equal(statusHasUncheckedNativeAuth(status('', { unchecked: true })), true);
  assert.equal(statusHasUncheckedNativeAuth(status('openai-codex')), false);
});

test('missing login errors are recognized for stale tab recovery', () => {
  assert.equal(isMissingLoginError(new Error('login not found')), true);
  assert.equal(isMissingLoginError(new Error('Request failed')), false);
});

test('late missing-login recovery only applies to the active login id', () => {
  const oldLogin = login('anthropic', 'pending');
  const newerLogin = { ...oldLogin, id: 'login-2' };
  assert.equal(shouldApplyMissingLoginRecovery(oldLogin, oldLogin), true);
  assert.equal(shouldApplyMissingLoginRecovery(newerLogin, oldLogin), false);
  assert.equal(shouldApplyMissingLoginRecovery(null, oldLogin), false);
});
