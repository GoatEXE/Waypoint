import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PodStore } from '../src/store.js';
import { statusAfterRun, taskPrompt } from '../src/taskQueue.js';

const planFactory = ({ podId }) => ({ command: 'docker', args: [], labels: {}, volumeName: podId, containerName: podId });

async function setup() {
  const store = new PodStore(await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-tasks-')));
  store.taskPrefix = async () => 'ORT';
  const template = await store.createTemplate({ name: 'web squad', version: '1', seats: [{ id: 'lead', role: 'Lead' }, { id: 'qa', role: 'QA' }] });
  const pod = await store.cloneTemplate(template.id, { podName: 'web-squad' }, planFactory);
  return { store, pod };
}

test('tasks get sequential org refs and optional assignees', async () => {
  const { store, pod } = await setup();
  const first = await store.createTask({ summary: 'Plan the site' });
  const second = await store.createTask({ summary: 'Build the API', podId: pod.id });
  const third = await store.createTask({ summary: 'Test it', podId: pod.id, seatId: 'qa', status: 'backlog', labels: ['QA Pass', 'qa pass'] });
  assert.deepEqual([first.ref, second.ref, third.ref], ['ORT-1', 'ORT-2', 'ORT-3']);
  assert.equal(first.status, 'todo');
  assert.equal(first.podId, null);
  assert.equal(second.seatId, null);
  assert.deepEqual(third.labels, ['qa-pass']);
  assert.equal((await store.getTaskView('ort-3')).id, third.id);
  await assert.rejects(store.createTask({ summary: 'x', seatId: 'qa' }), /seatId requires podId/);
  await assert.rejects(store.createTask({ summary: 'x', podId: pod.id, seatId: 'nobody' }), /seat does not belong/);
  await assert.rejects(store.createTask({ summary: 'x', status: 'blocked' }), /status must be/);
  await assert.rejects(store.createTask({ summary: 'x', title: 'y' }), /unsupported task fields/);
  await assert.rejects(store.createTask({ summary: '' }), /summary must be/);
});

test('task relationships resolve refs and reject cycles', async () => {
  const { store } = await setup();
  const parent = await store.createTask({ summary: 'Epic' });
  const child = await store.createTask({ summary: 'Child', parentId: parent.ref });
  const blocker = await store.createTask({ summary: 'Blocker' });
  assert.equal(child.parentId, parent.id);
  const blocked = await store.updateTask(child.ref, { blockedBy: [blocker.ref, blocker.id] });
  assert.deepEqual(blocked.blockedBy, [blocker.id]);
  await assert.rejects(store.updateTask(parent.id, { parentId: child.ref }), /cycle/);
  await assert.rejects(store.updateTask(parent.id, { parentId: parent.id }), /cycle/);
  await assert.rejects(store.updateTask(blocker.id, { blockedBy: [blocker.ref] }), /cannot block itself/);
  await assert.rejects(store.updateTask(blocker.id, { parentId: 'ORT-99' }), /not found/);
  const cleared = await store.updateTask(child.id, { parentId: null, description: 'More detail' });
  assert.equal(cleared.parentId, null);
  assert.equal(cleared.summary, 'Child');
  assert.equal(cleared.description, 'More detail');
});

test('projects are created once and validated on tasks', async () => {
  const { store } = await setup();
  const project = await store.createProject({ name: 'Website' });
  await assert.rejects(store.createProject({ name: 'website' }), /already exists/);
  const task = await store.createTask({ summary: 'Landing page', projectId: project.id });
  assert.equal(task.projectId, project.id);
  await assert.rejects(store.createTask({ summary: 'x', projectId: 'project_00000000-0000-4000-8000-000000000000' }), /does not match/);
  assert.deepEqual((await store.listProjects()).map((p) => p.name), ['Website']);
});

test('runs advance workflow status and running tasks cannot be reassigned', async () => {
  const { store, pod } = await setup();
  const task = await store.createTask({ summary: 'Ship it', podId: pod.id, seatId: 'lead' });
  const { runId } = await store.claimTaskRun(task.id);
  assert.equal((await store.getTaskView(task.id)).status, 'in_progress');
  await assert.rejects(store.updateTask(task.id, { seatId: 'qa', podId: pod.id }), /cannot be reassigned/);
  assert.equal((await store.updateTask(task.id, { labels: ['urgent'] })).state, 'running');
  await store.finishTaskRun(task.id, runId, { outcome: 'completed', text: 'done' });
  assert.equal((await store.getTaskView(task.id)).status, 'in_review');
  assert.equal(statusAfterRun('done', 'completed'), 'done');
  assert.equal(taskPrompt({ summary: 'Title', description: 'Body' }), 'Title\n\nBody');
});

test('legacy tasks are numbered once in creation order', async () => {
  const { store, pod } = await setup();
  const dir = path.join(store.dataDir, 'tasks');
  const legacy = (id, createdAt) => ({ id, podId: pod.id, seatId: 'lead', summary: 'old', state: 'completed', evidence: [], createdAt, updatedAt: createdAt });
  const a = 'task_00000000-0000-4000-8000-00000000000a';
  const b = 'task_00000000-0000-4000-8000-00000000000b';
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${b}.json`), JSON.stringify(legacy(b, '2026-02-01T00:00:00Z')));
  await fs.writeFile(path.join(dir, `${a}.json`), JSON.stringify(legacy(a, '2026-01-01T00:00:00Z')));
  assert.equal(await store.backfillTaskNumbers(), 2);
  assert.equal(await store.backfillTaskNumbers(), 0);
  const tasks = await store.listTasks();
  assert.equal(tasks.find((t) => t.id === a).ref, 'ORT-1');
  assert.equal(tasks.find((t) => t.id === b).status, 'in_review');
  assert.equal((await store.createTask({ summary: 'new' })).ref, 'ORT-3');
});

test('task and project routes accept refs and refuse runs without a seat', async () => {
  const { createApp } = await import('../src/index.js');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-tasks-http-'));
  const app = await createApp({ DATA_DIR: dataDir, WAYPOINT_CONTROL_DIR: path.join(dataDir, 'control'), LOG_LEVEL: 'error', HERMES_AUTO_START: 'false' });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const send = (method, url, body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const project = await send('POST', '/projects', { name: 'Website' }).then((r) => r.json());
    const created = await send('POST', '/tasks', { summary: 'Landing page', projectId: project.id });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).ref, 'WP-1');
    const patched = await send('PATCH', '/tasks/WP-1', { status: 'in_review' });
    assert.equal((await patched.json()).status, 'in_review');
    assert.equal((await send('POST', '/tasks/WP-1/run', {})).status, 409);
    const listed = await fetch(`${base}/tasks`).then((r) => r.json());
    assert.equal(listed.tasks[0].projectId, project.id);
    assert.equal((await fetch(`${base}/projects`).then((r) => r.json())).projects.length, 1);
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
});
