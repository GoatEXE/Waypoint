import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [podView, taskView, missionView, sidebar, routes] = await Promise.all([
  '../src/views/PodView.tsx',
  '../src/views/TaskView.tsx',
  '../src/views/MissionView.tsx',
  '../src/components/Sidebar.tsx',
  '../src/routes.ts',
].map(p => fs.readFile(new URL(p, import.meta.url), 'utf8')));

test('dynamic service task and pod ids route to real detail pages even when sample data is empty', () => {
  assert.match(routes, /a === 'tasks' && b && !c/);
  assert.match(routes, /a === 'pods' && b/);
  assert.equal(routes.includes('D.tasks.some(t => t.id === b)'), false);
  assert.equal(routes.includes('D.pods.some(p => p.name === b)'), false);
});

test('pod and task views load service records with refresh and not-found states', () => {
  assert.match(podView, /api\.podInstance\(podId\)/);
  assert.match(taskView, /api\.task\(id\)/);
  assert.match(taskView, /api\.podInstance\(task\.podId\)/);
  for (const source of [podView, taskView]) {
    assert.match(source, /Loading .*record/);
    assert.match(source, /not found/i);
    assert.match(source, /Refresh/);
  }
});

test('detail pages avoid static run fiction, local implementation fields, and process jargon', () => {
  const combined = `${podView}\n${taskView}`;
  assert.equal(combined.includes('seatTerminals'), false);
  assert.equal(combined.includes('Stop pod &'), false);
  assert.equal(combined.includes('worktree'), false);
  assert.equal(combined.includes('instanceDir'), false);
  assert.equal(combined.includes('profileDir'), false);
  assert.equal(combined.includes('profilesDir'), false);
  assert.equal(combined.includes('dockerPlan'), false);
  assert.equal(combined.includes('auth'), false);
  assert.equal(combined.includes('env'), false);
  assert.equal(combined.includes('Honest status'), false);
  assert.equal(combined.includes('service-backed task'), false);
  assert.equal(combined.includes('Docker/runtime plans'), false);
  assert.equal(combined.includes('Hermes execution is recorded'), false);
  assert.equal(combined.includes('Dry-run only'), false);
  assert.match(combined, /No runs yet/);
  assert.match(combined, /This pod is set up but not running/);
});

test('mission and sidebar links open stored pod/task records and task inline pod link is keyboard accessible', () => {
  assert.match(missionView, /nav\('\/pods\/' \+ pod\.id\)/);
  assert.match(missionView, /nav\('\/tasks\/' \+ task\.id\)/);
  assert.match(sidebar, /nav\('\/pods\/' \+ p\.id\)/);
  assert.match(sidebar, /api\.orgChart\(\)/);
  assert.match(sidebar, /api\.tasks\(\)/);
  assert.match(taskView, /<button type="button" className="ul mono"/);
  assert.match(taskView, /<OnDot on=\{taskStatusOn\(task\.state\)\}/);
  assert.equal(sidebar.includes("title={`${p.podName} · ${p.state === 'running' ? 'running' : 'not running'}`} onClick={() => nav('/')"), false);
});

test('TaskView renders durable run metadata and only starts runs from a user action', () => {
  assert.match(taskView, /function LatestRun/);
  assert.match(taskView, /latestRun\(task\)/);
  assert.match(taskView, /Run evidence/);
  assert.match(taskView, /Reply preview is capped/);
  assert.match(taskView, /api\.runTask\(load\.task\.id\)/);
  assert.match(taskView, /canStartRun\(task: TaskRecord, starting: boolean, pod: PodInstance \| null\)/);
  assert.match(taskView, /pod\?\.state === 'running'/);
  assert.match(taskView, /Start and prepare the pod first\./);
  assert.match(taskView, /onClick=\{\(\) => void startRun\(\)\}/);
  assert.match(taskView, /pollTask\(/);
  assert.doesNotMatch(taskView, /useEffect\(\(\) => \{[^}]*runTask/s);
  assert.match(taskView, /api\.retryTaskAfterReview\(load\.task\.id\)/);
  assert.match(taskView, /Retry after review/);
});
