import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_RE, LOGO_MAX_BYTES, ceoNameOf, cleanKey, deriveOrgKey, logoProblem } from '../src/orgModel.ts';

test('deriveOrgKey matches the service task prefix rule', () => {
  assert.equal(deriveOrgKey('Ortho Arkansas'), 'ORT');
  assert.equal(deriveOrgKey('9 Lives Labs'), 'LIV');
  assert.equal(deriveOrgKey(''), 'WP');
  assert.ok(KEY_RE.test(deriveOrgKey('Acme')));
});

test('cleanKey uppercases and limits prefix input', () => {
  assert.equal(cleanKey('ab-c d123456'), 'ABCD12');
});

test('logoProblem accepts small raster images only', () => {
  assert.equal(logoProblem({ type: 'image/png', size: 1000 }), null);
  assert.match(logoProblem({ type: 'image/svg+xml', size: 10 }) || '', /PNG/);
  assert.match(logoProblem({ type: 'image/jpeg', size: LOGO_MAX_BYTES + 1 }) || '', /KB/);
});

test('ceoNameOf falls back to CEO', () => {
  assert.equal(ceoNameOf(null), 'CEO');
  assert.equal(ceoNameOf({ name: 'Acme', key: 'ACM', ceoName: 'Ada', logo: null, createdAt: '', updatedAt: '' }), 'Ada');
});
