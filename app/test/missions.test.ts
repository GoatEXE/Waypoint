import test from 'node:test';
import assert from 'node:assert/strict';
import { api, type Mission } from '../src/api.ts';
import { initialMissionsState, missionFor, missionPath, missionsLoadFailed, missionsLoadStarted, missionsLoadSucceeded, moveMission, routeMission, sidebarMissionLabel, visibleMissions } from '../src/missionsModel.ts';
import { parseRoute } from '../src/routes.ts';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission_1', title: 'Finish Waypoint', outcome: 'Waypoint works end to end', target: null,
    taskId: 't_1a2b3c4d', status: 'todo', source: 'app',
    createdAt: '2026-10-06T07:00:00.000Z', updatedAt: '2026-10-06T07:00:00.000Z',
    ...overrides,
  };
}

test('mission edits use PATCH with only the changed fields', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init };
    return { ok: true, text: async () => JSON.stringify(mission({ status: 'in_review' })) } as Response;
  }) as typeof fetch;
  assert.equal((await api.updateMission('mission_1', { status: 'in_review', title: 'Renamed' })).status, 'in_review');
  assert.equal(request?.url, '/api/missions/mission_1');
  assert.equal(request?.init?.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { status: 'in_review', title: 'Renamed' });
});

test('missions load state moves through loading, ready, and error without losing loaded data', () => {
  assert.equal(initialMissionsState.status, 'loading');
  assert.equal(sidebarMissionLabel(initialMissionsState), 'Loading…');
  const ready = missionsLoadSucceeded([mission()]);
  assert.equal(missionFor(ready)?.title, 'Finish Waypoint');
  assert.equal(sidebarMissionLabel(ready), 'Finish Waypoint');
  assert.equal(missionsLoadStarted(ready).status, 'ready', 'refresh keeps showing the loaded mission');
  const failed = missionsLoadFailed(ready, 'Request failed (502)');
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'Request failed (502)');
  assert.equal(missionFor(failed), null);
  assert.equal(sidebarMissionLabel(failed), 'Missions unavailable');
  assert.equal(sidebarMissionLabel(missionsLoadSucceeded([])), 'No mission yet');
});


const many = (n: number) => Array.from({ length: n }, (_, i) => mission({ id: `m${i + 1}`, title: `Mission ${i + 1}` }));
const ids = (ms: Mission[]) => ms.map(m => m.id);

test('sidebar lists a single mission with no Show more', () => {
  assert.deepEqual(visibleMissions(many(1), false), { shown: many(1), hidden: 0 });
});

test('sidebar lists exactly three missions with no Show more', () => {
  const r = visibleMissions(many(3), false);
  assert.deepEqual(ids(r.shown), ['m1', 'm2', 'm3']);
  assert.equal(r.hidden, 0);
});

test('four or more missions show three plus Show more, and expanding reveals the rest', () => {
  const four = visibleMissions(many(4), false);
  assert.deepEqual(ids(four.shown), ['m1', 'm2', 'm3']);
  assert.equal(four.hidden, 1);
  const six = visibleMissions(many(6), false);
  assert.equal(six.hidden, 3);
  assert.deepEqual(ids(visibleMissions(many(6), true).shown), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  assert.equal(visibleMissions(many(6), true).hidden, 0);
});

test('a collapsed list still shows the open mission when it is past the first three', () => {
  const r = visibleMissions(many(6), false, 'm5');
  assert.deepEqual(ids(r.shown), ['m1', 'm2', 'm3', 'm5']);
  assert.equal(r.hidden, 2);
  assert.deepEqual(ids(visibleMissions(many(6), false, 'm2').shown), ['m1', 'm2', 'm3']);
});

test('mission pages route by mission id', () => {
  assert.deepEqual(parseRoute('/'), { v: 'mission' });
  assert.deepEqual(parseRoute('/missions/m2'), { v: 'mission', id: 'm2' });
  assert.deepEqual(parseRoute(missionPath('mission a/b')), { v: 'mission', id: 'mission a/b' });
  assert.equal(parseRoute('/missions').v, 'notfound');
  assert.equal(parseRoute('/missions/m2/extra').v, 'notfound');
});

test('the viewed mission follows the route, project, or task instead of the first mission', () => {
  const s = missionsLoadSucceeded(many(4));
  const projects = [{ id: 'p1', missionId: 'm1' }, { id: 'p3', missionId: 'm3' }, { id: 'p9', missionId: null }];
  const board = [{ id: 't_1', ref: 'W-1', projectId: 'p3' }, { id: 't_2', ref: 'W-2', projectId: 'p9' }];
  const at = (path: string) => routeMission(s, parseRoute(path), projects, board)?.id ?? null;
  assert.equal(at('/'), 'm1');
  assert.equal(at('/missions/m4'), 'm4');
  assert.equal(at('/missions/gone'), null);
  assert.equal(at('/projects/p3'), 'm3');
  assert.equal(at('/projects/p9'), null);
  assert.equal(at('/tasks/W-1'), 'm3');
  assert.equal(at('/tasks/t_1'), 'm3');
  assert.equal(at('/tasks/W-2'), null);
  assert.equal(at('/inbox'), null);
  assert.equal(routeMission(initialMissionsState, parseRoute('/missions/m2'), projects, board), null);
});

test('moveMission drops a mission before or after another one', () => {
  const list = ['a', 'b', 'c', 'd'].map(id => mission({ id, title: id }));
  const ids = (ms: Mission[]) => ms.map(m => m.id).join('');
  assert.equal(ids(moveMission(list, 'd', 'a', 'before')), 'dabc');
  assert.equal(ids(moveMission(list, 'a', 'd', 'after')), 'bcda');
  assert.equal(ids(moveMission(list, 'a', 'c', 'before')), 'bacd');
  assert.equal(ids(moveMission(list, 'c', 'a', 'after')), 'acbd');
  assert.equal(moveMission(list, 'a', 'a', 'after'), list);
  assert.equal(moveMission(list, 'x', 'a', 'before'), list);
});

test('mission reorder uses PUT /missions/order with the full id list', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init };
    return { ok: true, text: async () => JSON.stringify({ missions: [] }) } as Response;
  }) as typeof fetch;
  await api.reorderMissions(['mission_2', 'mission_1']);
  assert.equal(request?.url, '/api/missions/order');
  assert.equal(request?.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { order: ['mission_2', 'mission_1'] });
});
