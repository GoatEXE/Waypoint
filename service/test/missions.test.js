import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OrgStore } from '../src/store.js';

async function tempStore() {
  return new OrgStore(await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-missions-')));
}

test('a mission can be renamed and its outcome, target, and status edited', async () => {
  const store = await tempStore();
  const { mission } = await store.createMission({ title: 'Launch beta', outcome: 'Ten users' });
  const updated = await store.updateMission(mission.id, { title: ' Launch v1 ', outcome: '', target: '2026-12-01', status: 'in_progress' });
  assert.equal(updated.title, 'Launch v1');
  assert.equal(updated.outcome, '');
  assert.equal(updated.target, '2026-12-01');
  assert.equal(updated.status, 'in_progress');
  assert.deepEqual(await store.getMission(mission.id), updated);
  assert.equal((await store.updateMission(mission.id, { target: null })).target, null);
});

test('mission edits are validated', async () => {
  const store = await tempStore();
  const { mission } = await store.createMission({ title: 'One' });
  await store.createMission({ title: 'Two' });
  await assert.rejects(store.updateMission(mission.id, { title: 'two' }), /already exists/);
  await assert.rejects(store.updateMission(mission.id, { title: '  ' }), /title is required/);
  await assert.rejects(store.updateMission(mission.id, { target: 'soon' }), /YYYY-MM-DD/);
  await assert.rejects(store.updateMission(mission.id, { taskId: 't_abcdef' }), /unsupported mission fields/);
  await assert.rejects(store.updateMission(mission.id, {}), /nothing to update/);
  await store.updateMission(mission.id, { status: 'done' });
  await assert.rejects(store.updateMission(mission.id, { status: 'backlog' }), /cannot move from done/);
  assert.equal((await store.updateMission(mission.id, { title: 'One' })).title, 'One');
});

test('deleting a mission moves its projects out of it', async () => {
  const store = await tempStore();
  const { mission } = await store.createMission({ title: 'Gone soon' });
  const { mission: other } = await store.createMission({ title: 'Stays' });
  const a = await store.createProject({ name: 'A', missionId: mission.id });
  const b = await store.createProject({ name: 'B', missionId: other.id });
  await store.deleteMission(mission.id);
  const projects = await store.listProjects();
  assert.equal(projects.find((p) => p.id === a.id).missionId, null);
  assert.equal(projects.find((p) => p.id === b.id).missionId, other.id);
  assert.equal((await store.updateProject(a.id, { missionId: other.id })).missionId, other.id);
});
