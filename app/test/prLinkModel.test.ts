import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api.ts';
import { needsPrLink, prNeededFrom, prUrlFor } from '../src/prLinkModel.ts';

test('a pr_missing approval error becomes a PR picker prompt', () => {
  const body = { error: { code: 'pr_missing', message: "builder didn't link a pull request.", details: { repo: 'Acme/Site', candidates: ['https://github.com/Acme/Site/pull/4', 7] } } };
  assert.deepEqual(prNeededFrom(new ApiError('x', 409, body)), { message: "builder didn't link a pull request.", repo: 'Acme/Site', candidates: ['https://github.com/Acme/Site/pull/4'] });
  assert.equal(prNeededFrom(new ApiError('x', 409, { error: { code: 'conflict', message: 'x' } })), null);
  assert.equal(prNeededFrom(new ApiError('x', 422, body)), null);
  assert.equal(prNeededFrom(new Error('x')), null);
});

test('a pasted PR must be a pull request in the task repo', () => {
  assert.equal(prUrlFor('12', 'Acme/Site'), 'https://github.com/Acme/Site/pull/12');
  assert.equal(prUrlFor('#12', 'Acme/Site'), 'https://github.com/Acme/Site/pull/12');
  assert.equal(prUrlFor(' https://github.com/acme/site/pull/9/files ', 'Acme/Site'), 'https://github.com/acme/site/pull/9');
  assert.equal(prUrlFor('https://github.com/other/repo/pull/9', 'Acme/Site'), null);
  assert.equal(prUrlFor('https://github.com/Acme/Site/issues/9', 'Acme/Site'), null);
  assert.equal(prUrlFor('0', 'Acme/Site'), null);
});

test('a review on a repo task without a linked PR is flagged before approval', () => {
  assert.equal(needsPrLink({ status: 'review', prRepo: 'Acme/Site', prLinked: null }), true);
  assert.equal(needsPrLink({ status: 'review', prRepo: 'Acme/Site', prLinked: 'https://github.com/Acme/Site/pull/1' }), false);
  assert.equal(needsPrLink({ status: 'review', prRepo: null }), false);
  assert.equal(needsPrLink({ status: 'running', prRepo: 'Acme/Site', prLinked: null }), false);
});
