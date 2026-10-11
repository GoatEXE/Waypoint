import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLinks, splitTaskRefs } from '../src/taskRefs.ts';

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

test('urls and markdown links in text become link parts', () => {
  assert.deepEqual(splitLinks('See https://github.com/o/r/pull/7.'), ['See ', { url: 'https://github.com/o/r/pull/7', label: 'https://github.com/o/r/pull/7' }, '.']);
  assert.deepEqual(splitLinks('Open [PR #7](https://github.com/o/r/pull/7) now'), ['Open ', { url: 'https://github.com/o/r/pull/7', label: 'PR #7' }, ' now']);
  assert.deepEqual(splitLinks('(https://example.com/a)'), ['(', { url: 'https://example.com/a', label: 'https://example.com/a' }, ')']);
  assert.deepEqual(splitLinks('https://en.wikipedia.org/wiki/A_(b)'), [{ url: 'https://en.wikipedia.org/wiki/A_(b)', label: 'https://en.wikipedia.org/wiki/A_(b)' }]);
  assert.deepEqual(splitLinks('no links, ftp://x stays'), ['no links, ftp://x stays']);
});
