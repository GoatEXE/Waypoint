import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/views/SettingsView.tsx', import.meta.url), 'utf8');

test('Settings presents simple automatic CEO state without manual lifecycle controls', () => {
  assert.equal(source.includes('Start CEO'), false);
  assert.equal(source.includes('>Stop<'), false);
  assert.equal(source.includes("hermesLifecycle('start')"), false);
  assert.equal(source.includes("hermesLifecycle('stop')"), false);
  assert.match(source, /CEO is on\./);
  assert.match(source, /CEO is unavailable\. Check Docker and refresh\./);
});

test('Settings uses a fresh auth status load without implementation-detail copy', () => {
  assert.match(source, /loadStatus\(\{ freshAuth: true \}\)/);
  assert.equal(source.includes('reconciled'), false);
  assert.equal(source.includes('native Hermes status'), false);
  assert.equal(source.includes('fast status'), false);
  assert.equal(source.includes('readiness waits'), false);
});
