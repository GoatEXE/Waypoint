import test from 'node:test';
import assert from 'node:assert/strict';
import { api, type Mission } from '../src/api.ts';
import { currentMission, initialMissionsState, missionsLoadFailed, missionsLoadStarted, missionsLoadSucceeded, sidebarMissionLabel } from '../src/missionsModel.ts';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission_1', title: 'Finish Waypoint', outcome: 'Waypoint works end to end', target: null,
    taskId: 't_1a2b3c4d', status: 'todo', source: 'app',
    createdAt: '2026-10-06T07:00:00.000Z', updatedAt: '2026-10-06T07:00:00.000Z',
    ...overrides,
  };
}

test('mission status update uses PATCH with the selected workflow status', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init };
    return { ok: true, text: async () => JSON.stringify(mission({ status: 'in_review' })) } as Response;
  }) as typeof fetch;
  assert.equal((await api.updateMission('mission_1', 'in_review')).status, 'in_review');
  assert.equal(request?.url, '/api/missions/mission_1');
  assert.equal(request?.init?.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { status: 'in_review' });
});

test('missions load state moves through loading, ready, and error without losing loaded data', () => {
  assert.equal(initialMissionsState.status, 'loading');
  assert.equal(sidebarMissionLabel(initialMissionsState), 'Loading…');
  const ready = missionsLoadSucceeded([mission()]);
  assert.equal(currentMission(ready)?.title, 'Finish Waypoint');
  assert.equal(sidebarMissionLabel(ready), 'Finish Waypoint');
  assert.equal(missionsLoadStarted(ready).status, 'ready', 'refresh keeps showing the loaded mission');
  const failed = missionsLoadFailed(ready, 'Request failed (502)');
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'Request failed (502)');
  assert.equal(currentMission(failed), null);
  assert.equal(sidebarMissionLabel(failed), 'Missions unavailable');
  assert.equal(sidebarMissionLabel(missionsLoadSucceeded([])), 'No mission yet');
});

