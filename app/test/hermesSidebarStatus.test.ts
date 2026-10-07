import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarHermesSummary } from '../src/hermesSidebarStatus.ts';
import type { HermesStatus } from '../src/api.ts';

function status(overrides: Partial<HermesStatus> = {}): HermesStatus {
  return {
    image: 'img',
    imagePinned: true,
    containerName: 'waypoint-hermes-ceo',
    volumeName: 'waypoint-hermes-ceo-home',
    runtime: { state: 'running', running: true },
    model: { configured: true, provider: 'anthropic', default: 'claude-opus-5-5', api_mode: 'anthropic_messages' },
    auth: {
      anthropic: {
        credentialPresent: false,
        oauthPresent: false,
        apiKeyPresent: false,
        authenticated: true,
        ready: true,
        native: { checked: true, authenticated: true, state: 'authenticated', message: 'ok' },
      },
    },
    ...overrides,
  };
}

test('sidebar reports ready when fresh native auth is authenticated', () => {
  assert.deepEqual(sidebarHermesSummary(status(), true), { label: 'Hermes CEO ready', ready: true });
});

test('sidebar stays neutral while CEO status has not been verified', () => {
  assert.deepEqual(sidebarHermesSummary(null, false), { label: 'Checking CEO…', ready: false });
});

test('sidebar does not call authenticated native status pending', () => {
  const s = status({ auth: { anthropic: { credentialPresent: false, oauthPresent: false, apiKeyPresent: false, authenticated: false, ready: false, native: { checked: true, authenticated: true, state: 'authenticated', message: 'ok' } } } });
  assert.deepEqual(sidebarHermesSummary(s, true), { label: 'Hermes CEO ready', ready: true });
});
