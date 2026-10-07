import test from 'node:test';
import assert from 'node:assert/strict';
import { applySavedModelIfClean, DEFAULTS, type ModelState } from '../src/settingsModel.ts';
import type { HermesStatus } from '../src/api.ts';

function statusWithSavedModel(provider: string, defaultModel: string): HermesStatus {
  return {
    image: 'img',
    imagePinned: true,
    containerName: 'waypoint-hermes-ceo',
    volumeName: 'waypoint-hermes-ceo-home',
    runtime: { state: 'running', running: true },
    model: { configured: true, provider, default: defaultModel, base_url: '', api_mode: DEFAULTS['openai-codex'].api_mode },
    auth: {},
  };
}

test('delayed initial status does not overwrite a user-edited provider/model draft', () => {
  const userDraft: ModelState = { provider: 'anthropic', default: 'claude-sonnet-5', base_url: '', api_mode: 'anthropic_messages' };
  const delayedSaved = statusWithSavedModel('openai-codex', 'gpt-5-codex');
  assert.deepEqual(applySavedModelIfClean(userDraft, delayedSaved, true), userDraft);
});

test('saved current model hydrates only while the settings form is clean', () => {
  const cleanInitial: ModelState = { provider: 'openai-codex', default: DEFAULTS['openai-codex'].default, base_url: '', api_mode: DEFAULTS['openai-codex'].api_mode };
  const saved = statusWithSavedModel('openai', 'gpt-4o');
  assert.deepEqual(applySavedModelIfClean(cleanInitial, saved, false), { provider: 'openai-api', default: 'gpt-4o', base_url: '', api_mode: DEFAULTS['openai-codex'].api_mode });
});
