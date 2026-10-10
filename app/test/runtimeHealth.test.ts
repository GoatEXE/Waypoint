import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api.ts';
import { causeOfError, errorText, runtimeHealth, startFailureText } from '../src/runtimeHealth.ts';
import type { HermesStatus } from '../src/api.ts';

const apiError = (status: number, code: string, message: string) => new ApiError(message, status, { error: { code, message } });

function status(runtime: HermesStatus['runtime']): HermesStatus {
  return { image: 'img', imagePinned: true, containerName: 'c', volumeName: 'v', runtime, model: { configured: false, provider: 'anthropic', default: '' }, auth: {} };
}

test('runtime errors map to one plain cause each', () => {
  assert.equal(causeOfError(apiError(503, 'docker_unavailable', "Docker isn't running.")), 'docker');
  assert.equal(causeOfError(apiError(409, 'ceo_stopped', 'The CEO is stopped.')), 'ceo-stopped');
  assert.equal(causeOfError(apiError(502, 'control_unavailable', 'down')), 'service');
  assert.equal(causeOfError(new TypeError('Failed to fetch')), 'service');
  assert.equal(causeOfError(apiError(400, 'bad_request', 'title is required')), null);
  assert.equal(errorText(apiError(503, 'docker_unavailable', 'raw docker text')), "Docker isn't running. Start Docker Desktop, then retry.");
  assert.equal(errorText(apiError(400, 'bad_request', 'title is required')), 'title is required');
});

test('runtime health states are final once a check finished', () => {
  assert.equal(runtimeHealth(null, null, false).cause, 'checking');
  assert.equal(runtimeHealth(null, new TypeError('Failed to fetch'), true).cause, 'service');
  assert.equal(runtimeHealth(status({ state: 'docker_unavailable', running: false }), null, true).cause, 'docker');
  assert.equal(runtimeHealth(status({ state: 'missing', running: false }), null, true).canStart, true);
  assert.equal(runtimeHealth(status({ state: 'exited', running: false }), null, true).label, 'CEO stopped');
});

test('start failures and timeouts say what to do next', () => {
  assert.match(startFailureText(null, true), /90 seconds.*Docker Desktop/);
  assert.match(startFailureText(apiError(503, 'docker_unavailable', 'x'), false), /Start Docker Desktop/);
});

test('Start CEO posts the lifecycle start action', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, text: async () => JSON.stringify({ action: 'start', executed: true }) } as Response;
  }) as typeof fetch;
  await api.hermesLifecycle('start');
  assert.equal(calls[0].url, '/api/hermes/lifecycle');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { action: 'start' });
});
