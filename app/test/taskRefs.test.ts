import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTaskRefs } from '../src/taskRefs.ts';

test('task refs in text become link parts only for the organization key', () => {
  assert.deepEqual(splitTaskRefs('Created SUN-4, see `SUN-12`.', 'SUN'), ['Created ', { ref: 'SUN-4' }, ', see `', { ref: 'SUN-12' }, '`.']);
  assert.deepEqual(splitTaskRefs('XSUN-4 and SUN-0 and SUN-4a stay text', 'SUN'), ['XSUN-4 and SUN-0 and SUN-4a stay text']);
  assert.deepEqual(splitTaskRefs('SUN-1', 'SUN'), [{ ref: 'SUN-1' }]);
  assert.deepEqual(splitTaskRefs('SUN-1', null), ['SUN-1']);
  assert.deepEqual(splitTaskRefs('SUN-1', 'S.*'), ['SUN-1']);
});

test('board ids in text show as their ref, unknown ids stay text', () => {
  assert.deepEqual(splitTaskRefs('Task t_a7784338 is running.', 'SUN', { t_a7784338: 'SUN-1' }), ['Task ', { ref: 'SUN-1' }, ' is running.']);
  assert.deepEqual(splitTaskRefs('Task t_deadbeef is gone.', 'SUN', {}), ['Task t_deadbeef is gone.']);
});
