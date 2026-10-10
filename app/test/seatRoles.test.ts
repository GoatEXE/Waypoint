import test from 'node:test';
import assert from 'node:assert/strict';
import { seatRole } from '../src/seatRoles.ts';

test('seat roles come from the seat id first, then its description', () => {
  assert.equal(seatRole('frontend-dev'), 'engineer');
  assert.equal(seatRole('designer'), 'designer');
  assert.equal(seatRole('explorer', 'Reads code and maps workflows'), 'researcher');
  assert.equal(seatRole('qa'), 'reviewer');
  assert.equal(seatRole('sam', 'Writes the docs'), 'writer');
  assert.equal(seatRole('sam'), 'generalist');
});
