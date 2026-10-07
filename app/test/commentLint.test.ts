import test from 'node:test';
import assert from 'node:assert/strict';
import { findComments } from '../scripts/lint-comments.mjs';

test('comment lint finds JavaScript and JSX comments without rejecting URLs or regular expressions', () => {
  assert.equal(findComments('const url = "https://example.test/a"; const pattern = /a\\/\\/b/;', '.js').length, 0);
  assert.equal(findComments('const answer = 42; // explanation', '.js').length, 1);
  assert.equal(findComments('const view = <div>{/* explanation */}</div>;', '.tsx').length, 1);
});

test('comment lint covers CSS, HTML, and Dockerfile comments', () => {
  assert.equal(findComments('a { color: red; } /* explanation */', '.css').length, 1);
  assert.equal(findComments('<main></main><!-- explanation -->', '.html').length, 1);
  assert.equal(findComments('FROM node:22\n# explanation\nRUN true', 'Dockerfile').length, 1);
  assert.equal(findComments('services:\n  # explanation\n  app: {}', '.yaml').length, 1);
});
