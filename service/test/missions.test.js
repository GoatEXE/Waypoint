import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PodStore } from '../src/store.js';
import { createApp } from '../src/index.js';

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-mission-')); }
function planFactory() { return { command: 'docker', args: [], labels: {} }; }

async function seededStore(dataDir) {
  const store = new PodStore(dataDir || await tmp());
  await store.ensure();
  const template = await store.createTemplate({ name: 'finish-waypoint', version: '1', seats: [{ id: 'lead', role: 'Lead' }, { id: 'builder', role: 'Builder' }] });
  const pod = await store.cloneTemplate(template.id, { podName: 'finish-waypoint-01' }, planFactory);
  const task = await store.createTask({ podId: pod.id, seatId: 'lead', summary: 'Plan the remaining work' });
  return { store, template, pod, task };
}

test('missions persist with linked pod/task summaries and honest delegated state', async () => {
  const dataDir = await tmp();
  const { store, pod, task } = await seededStore(dataDir);
  const { created, mission } = await store.createMission({ title: 'Finish Waypoint', outcome: 'Waypoint works end to end', taskId: task.id }, { source: 'ceo' });
  assert.equal(created, true);
  assert.match(mission.id, /^mission_/);
  assert.equal(mission.podId, pod.id, 'task implies its pod');
  assert.equal(mission.state, 'delegated');
  assert.equal(mission.source, 'ceo');
  assert.equal(mission.pod.podName, 'finish-waypoint-01');
  assert.deepEqual(mission.pod.seats.map((s) => s.id), ['lead', 'builder']);
  assert.equal(mission.task.seatId, 'lead');
  assert.equal(mission.task.state, 'delegated');
  assert.match(mission.task.evidence[0].message, /no Hermes execution/);
  assert.deepEqual(mission.missing, []);
  assert.equal(JSON.stringify(mission).includes(dataDir), false, 'view must not leak local paths');

  const reloaded = new PodStore(dataDir);
  const listed = await reloaded.listMissions();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, 'Finish Waypoint');
  assert.equal((await reloaded.getMission(mission.id)).task.id, task.id);
});

test('mission creation is idempotent by title and rejects conflicting duplicates', async () => {
  const { store, pod, task } = await seededStore();
  const first = await store.createMission({ title: 'Finish Waypoint', podId: pod.id, taskId: task.id });
  const again = await store.createMission({ title: '  finish waypoint ', podId: pod.id, taskId: task.id });
  assert.equal(again.created, false);
  assert.equal(again.mission.id, first.mission.id);
  await assert.rejects(store.createMission({ title: 'Finish Waypoint' }), (error) => error.status === 409);
  const [a, b] = await Promise.all([store.createMission({ title: 'Parallel' }), store.createMission({ title: 'Parallel' })]);
  assert.equal(a.mission.id, b.mission.id, 'concurrent creates do not duplicate');
  assert.equal((await store.listMissions()).length, 2);
});

test('mission links are validated against stored records', async () => {
  const { store, pod, task } = await seededStore();
  const other = await store.cloneTemplate(pod.templateId, { podName: 'other-pod' }, planFactory);
  await assert.rejects(store.createMission({}), /title is required/);
  await assert.rejects(store.createMission({ title: 'x'.repeat(121) }), /at most 120/);
  await assert.rejects(store.createMission({ title: 'Bad date', target: '2026-13-45' }), /YYYY-MM-DD/);
  await assert.rejects(store.createMission({ title: 'Bad id', podId: '../escape' }), /invalid resource id/);
  await assert.rejects(store.createMission({ title: 'Ghost pod', podId: 'pod_00000000-0000-4000-8000-000000000000' }), /does not match a stored pod/);
  await assert.rejects(store.createMission({ title: 'Ghost task', taskId: 'task_00000000-0000-4000-8000-000000000000' }), /does not match a stored task/);
  await assert.rejects(store.createMission({ title: 'Mismatch', podId: other.id, taskId: task.id }), (error) => error.status === 409);
  assert.equal((await store.listMissions()).length, 0, 'failed creates write nothing');
});

test('planned missions can be linked later without replacing existing links', async () => {
  const { store, pod, task } = await seededStore();
  const { mission } = await store.createMission({ title: 'Later link', target: '2026-12-01' });
  assert.equal(mission.state, 'planned');
  assert.equal(mission.pod, null);
  const withPod = await store.linkMission(mission.id, { podId: pod.id });
  assert.equal(withPod.state, 'planned');
  const linked = await store.linkMission(mission.id, { taskId: task.id });
  assert.equal(linked.state, 'delegated');
  assert.equal(linked.task.id, task.id);
  const other = await store.cloneTemplate(pod.templateId, { podName: 'other-pod' }, planFactory);
  await assert.rejects(store.linkMission(mission.id, { podId: other.id }), (error) => error.status === 409);
});

test('mission view reports missing linked records instead of failing', async () => {
  const dataDir = await tmp();
  const { store, task } = await seededStore(dataDir);
  const { mission } = await store.createMission({ title: 'Orphaned', taskId: task.id });
  await fs.rm(store.taskPath(task.id));
  const view = await store.getMission(mission.id);
  assert.equal(view.task, null);
  assert.deepEqual(view.missing, ['task']);
});

test('deleting a mission preserves its linked pod and task', async () => {
  const dataDir = await tmp();
  const { store, pod, task } = await seededStore(dataDir);
  const { mission } = await store.createMission({ title: 'Too broad', taskId: task.id });
  assert.deepEqual(await store.deleteMission(mission.id), { deleted: true, missionId: mission.id, podId: pod.id, taskId: task.id });
  assert.deepEqual(await store.listMissions(), []);
  assert.equal((await store.getTask(task.id)).id, task.id);
  assert.equal((await store.getInstance(pod.id)).id, pod.id);
  await assert.rejects(store.deleteMission(mission.id), (error) => error.status === 404);
  await assert.rejects(store.deleteMission('../bad'), (error) => error.status === 400);
});

test('HTTP and bridge mission endpoints create, list, and stay token-protected', async () => {
  const dataDir = await tmp();
  const { pod, task } = await seededStore(dataDir);
  const app = await createApp({ PORT: '3081', HOST: '127.0.0.1', DATA_DIR: dataDir, WAYPOINT_CONTROL_DIR: path.join(dataDir, 'control'), LOG_LEVEL: 'error', HERMES_AUTO_START: 'false' });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => app.bridgeServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const bridgeBase = `http://127.0.0.1:${app.bridgeServer.address().port}`;
  const post = (url, body, headers = {}) => fetch(`${url === '/bridge/tools' ? bridgeBase : base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await fetch(`${base}/missions`).then((r) => r.json()), { missions: [] });
    const denied = await post('/bridge/tools', { tool: 'create_mission', args: { title: 'Finish Waypoint' } });
    assert.equal(denied.status, 403);
    const auth = { authorization: `Bearer ${app.config.bridge.token}` };
    const bridged = await post('/bridge/tools', { tool: 'create_mission', args: { title: 'Finish Waypoint', podId: pod.id, taskId: task.id } }, auth).then((r) => r.json());
    assert.equal(bridged.created, true);
    assert.equal(bridged.mission.source, 'ceo');
    const repeat = await post('/missions', { title: 'Finish Waypoint', podId: pod.id, taskId: task.id });
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).id, bridged.mission.id);
    const fresh = await post('/missions', { title: 'Second mission', outcome: 'Something measurable' });
    assert.equal(fresh.status, 201);
    const second = await fresh.json();
    assert.equal(second.source, 'app');
    assert.equal(second.state, 'planned');
    const linked = await post('/bridge/tools', { tool: 'link_mission', args: { missionId: second.id, podId: pod.id } }, auth).then((r) => r.json());
    assert.equal(linked.pod.id, pod.id);
    const listed = await post('/bridge/tools', { tool: 'list_missions', args: {} }, auth).then((r) => r.json());
    assert.deepEqual(listed.missions.map((m) => m.title).sort(), ['Finish Waypoint', 'Second mission']);
    const one = await fetch(`${base}/missions/${bridged.mission.id}`).then((r) => r.json());
    assert.equal(one.task.id, task.id);
    const bad = await post('/missions', { title: 'Ghost', podId: 'pod_00000000-0000-4000-8000-000000000000' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'bad_request');
    assert.equal((await fetch(`${base}/missions/nope`)).status, 400);
    assert.equal((await fetch(`${base}/missions/mission_00000000-0000-4000-8000-000000000000`)).status, 404);
    const bridgeDelete = await fetch(`${bridgeBase}/missions/${second.id}`, { method: 'DELETE', headers: auth });
    assert.equal(bridgeDelete.status, 404);
    const deleted = await fetch(`${base}/missions/${second.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).missionId, second.id);
    assert.equal((await fetch(`${base}/missions/${second.id}`)).status, 404);
    const tasks = await fetch(`${base}/tasks`).then((r) => r.json());
    assert.equal(tasks.tasks.find((item) => item.id === task.id).state, 'delegated');
    assert.equal(tasks.tasks.find((item) => item.id === task.id).evidence, undefined, 'list is a short navigation summary');
    assert.equal((await fetch(`${bridgeBase}/tasks`)).status, 404);
  } finally { await Promise.all([app.server, app.bridgeServer].map((s) => new Promise((resolve) => s.close(resolve)))); }
});

test('CEO bridge skill tells the CEO to record and link missions without claiming execution', async () => {
  const source = await fs.readFile(new URL('../src/hermes.js', import.meta.url), 'utf8');
  const skillLine = source.split('\n').find((line) => line.startsWith('skill="'));
  const skill = JSON.parse(skillLine.slice('skill='.length));
  for (const tool of ['list_missions', 'create_mission', 'link_mission']) assert.match(skill, new RegExp(`## ${tool}`));
  assert.match(skill, /When the user asks for a mission/);
  assert.match(skill, /do not create a duplicate/);
  assert.match(skill, /does not mean anything has run/);
});
