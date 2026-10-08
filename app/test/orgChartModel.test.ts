import test from 'node:test';
import assert from 'node:assert/strict';
import type { TaskSummary } from '../src/api.ts';
import { buildOrgTree } from '../src/orgChartModel.ts';

function task(number: number, fields: Partial<TaskSummary> = {}): TaskSummary {
  return { id: `task_${number}`, number, ref: `SUN-${number}`, summary: `Task ${number}`, description: '', status: 'todo', state: 'delegated', podId: null, seatId: null, projectId: null, labels: [], parentId: null, blockedBy: [], createdAt: '', updatedAt: '', ...fields };
}

test('buildOrgTree places open tasks under their seat, pod, or unassigned', () => {
  const chart = { ceo: { address: 'ceo', name: 'Jeff', role: 'CEO' }, pods: [{ podId: 'pod_1', name: 'web', state: 'running', seats: [{ seatId: 'lead', role: 'Lead' }, { seatId: 'qa', role: 'QA' }] }] };
  const tree = buildOrgTree(chart, [
    task(1, { podId: 'pod_1', seatId: 'lead', state: 'running', status: 'in_progress' }),
    task(2, { podId: 'pod_1', seatId: 'lead' }),
    task(3, { podId: 'pod_1' }),
    task(4, { podId: 'pod_1', seatId: 'qa', status: 'done' }),
    task(5),
    task(6, { podId: 'pod_gone', seatId: 'x' }),
  ]);
  const [pod] = tree.pods;
  assert.equal(pod.openCount, 3);
  assert.equal(pod.runningCount, 1);
  assert.equal(pod.seats[0].running?.ref, 'SUN-1');
  assert.deepEqual(pod.seats[0].open.map(t => t.ref), ['SUN-1', 'SUN-2']);
  assert.deepEqual(pod.seats[1].open, []);
  assert.deepEqual(pod.podOnly.map(t => t.ref), ['SUN-3']);
  assert.deepEqual(tree.unassigned.map(t => t.ref), ['SUN-5', 'SUN-6']);
});
