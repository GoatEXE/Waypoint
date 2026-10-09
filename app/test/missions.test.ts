import test from 'node:test';
import assert from 'node:assert/strict';
import { api, type Mission } from '../src/api.ts';
import {
  currentMission, initialMissionsState, missionPods, missionStatus, missionsLoadFailed, missionsLoadStarted,
  missionsLoadSucceeded, podStateLabel, sidebarMissionLabel, taskStateLabel,
} from '../src/missionsModel.ts';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission_1', title: 'Finish Waypoint', outcome: 'Waypoint works end to end', target: '',
    podId: 'pod_1', taskId: 'task_1', status: 'todo', source: 'app',
    createdAt: '2026-10-06T07:00:00.000Z', updatedAt: '2026-10-06T07:00:00.000Z',
    pod: { id: 'pod_1', podName: 'finish-waypoint-01', templateId: 'tpl_1', state: 'planned', seats: [{ id: 'lead', role: 'Lead' }, { id: 'builder', role: 'Builder' }] },
    task: { id: 'task_1', podId: 'pod_1', seatId: 'lead', summary: 'Plan the work', state: 'completed', status: 'in_review', evidence: [], updatedAt: '2026-10-06T06:33:29.457Z' },
    missing: [],
    ...overrides,
  };
}

test('missions API lists and creates through the local service', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = init?.method === 'POST' ? mission({ title: 'New one' }) : { missions: [mission()] };
    return { ok: true, text: async () => JSON.stringify(body) } as Response;
  }) as typeof fetch;

  const { missions } = await api.missions();
  assert.equal(missions[0].title, 'Finish Waypoint');
  await api.createMission({ title: 'New one', outcome: '', target: '' });
  assert.equal(calls[0].url, '/api/missions');
  assert.equal(calls[1].url, '/api/missions');
  assert.equal(calls[1].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { title: 'New one', outcome: '', target: '' });
});

test('missions API surfaces the service error for duplicates', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ error: { code: 'conflict', message: 'a mission with this title already exists' } }) }) as Response) as typeof fetch;
  await assert.rejects(() => api.createMission({ title: 'Finish Waypoint' }), /already exists/);
});

test('mission deletion uses the host API', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, text: async () => JSON.stringify({ deleted: true, missionId: 'mission_1', podId: 'pod_1', taskId: 'task_1' }) } as Response;
  }) as typeof fetch;
  assert.equal((await api.deleteMission('mission_1')).deleted, true);
  assert.equal(calls[0].url, '/api/missions/mission_1');
  assert.equal(calls[0].init?.method, 'DELETE');
});

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

test('mission status copy never claims work has run', () => {
  const delegated = missionStatus(mission());
  assert.equal(delegated.label, 'Todo');
  assert.match(delegated.detail, /Linked task run: completed/);
  assert.equal(taskStateLabel('delegated'), 'Handed off, not started');
  assert.equal(podStateLabel('planned'), 'Set up, not running');

  const planned = missionStatus(mission({ status: 'backlog', podId: null, taskId: null, pod: null, task: null }));
  assert.equal(planned.label, 'Backlog');
  assert.match(planned.detail, /No pod or task is assigned yet/);

  const review = missionStatus(mission({ status: 'in_review' }));
  assert.equal(review.label, 'In review');
  assert.doesNotMatch(review.label, /completed/i);

  for (const m of [delegated, planned, review]) assert.doesNotMatch(m.label, /completed/i);
});

test('sidebar pods come from mission links without duplicates', () => {
  const pods = missionPods([mission(), mission({ id: 'mission_2', title: 'Other' }), mission({ id: 'mission_3', pod: null, podId: null, task: null, taskId: null })]);
  assert.deepEqual(pods.map(p => p.podName), ['finish-waypoint-01']);
});
