import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeHealth } from '../src/runtimeHealth.ts';

const sidebarHermesSummary = (s: HermesStatus | null, checked: boolean, error: unknown = null) => {
  const health = runtimeHealth(s, error, checked);
  return { label: health.label, ready: health.ready };
};
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
  assert.deepEqual(sidebarHermesSummary(status(), true), { label: 'CEO ready', ready: true });
});

test('sidebar stays neutral while CEO status has not been verified', () => {
  assert.deepEqual(sidebarHermesSummary(null, false), { label: 'Checking CEO…', ready: false });
});

test('sidebar does not call authenticated native status pending', () => {
  const s = status({ auth: { anthropic: { credentialPresent: false, oauthPresent: false, apiKeyPresent: false, authenticated: false, ready: false, native: { checked: true, authenticated: true, state: 'authenticated', message: 'ok' } } } });
  assert.deepEqual(sidebarHermesSummary(s, true), { label: 'CEO ready', ready: true });
});

test('sidebar tells a down service apart from a down CEO', () => {
  const unreachable = Object.assign(new Error('Waypoint control service is unavailable'), { status: 502, body: { error: { code: 'control_unavailable' } } });
  assert.deepEqual(sidebarHermesSummary(null, true, unreachable), { label: 'Service unreachable', ready: false });
  assert.deepEqual(sidebarHermesSummary(status({ runtime: { state: 'docker_unavailable', running: false } }), true), { label: 'Docker not running', ready: false });
  assert.deepEqual(sidebarHermesSummary(status({ runtime: { state: 'exited', running: false } }), true), { label: 'CEO stopped', ready: false });
});
