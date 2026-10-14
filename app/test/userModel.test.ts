import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_NAME_MAX, initialsOf, userNameOf, userNameOk } from '../src/userModel.ts';

test('a name is required and bounded', () => {
  assert.equal(userNameOk(''), false);
  assert.equal(userNameOk('   '), false);
  assert.equal(userNameOk('Ada'), true);
  assert.equal(userNameOk('x'.repeat(USER_NAME_MAX + 1)), false);
});

test('initials and fallback name', () => {
  assert.equal(initialsOf('Ada Lovelace'), 'AL');
  assert.equal(initialsOf('ada'), 'AD');
  assert.equal(initialsOf(' '), '?');
  assert.equal(userNameOf(null), 'You');
});
