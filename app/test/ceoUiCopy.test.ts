import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const rightPane = await fs.readFile(new URL('../src/components/RightPane.tsx', import.meta.url), 'utf8');
const modal = await fs.readFile(new URL('../src/components/Modal.tsx', import.meta.url), 'utf8');

test('CEO pane copy points users to real conversation send', () => {
  assert.match(rightPane, /Send a message to start the conversation/);
  assert.match(rightPane, /Message the CEO/);
  assert.match(rightPane, /Reply not confirmed/);
  assert.match(rightPane, /Refresh conversation/);
  assert.equal(rightPane.includes('live dispatch not connected'), false);
  assert.equal(rightPane.includes('local note'), false);
  assert.equal(rightPane.includes('Not sent'), false);
});

test('New Assignment submits to CEO conversation instead of local note fiction', () => {
  assert.match(modal, /Send to CEO/);
  assert.match(modal, /sendCeoMessage\(form\.text\.trim\(\), true\)/);
  assert.equal(modal.includes('Save note'), false);
  assert.equal(modal.includes('records your note in the local pane'), false);
});
