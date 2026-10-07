import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';

test('structured fields survive recursive redaction', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(JSON.parse(line));
  try {
    createLogger({ serviceName: 'waypoint-test' }).info('request', {
      method: 'GET', status: 200,
      nested: { count: 2, token: 'private-token-value' },
      items: [{ safe: 'ok', password: 'private-password' }],
      apiKey: 'private-key',
      message: 'sk-abcdefghijklmnopqrstuv',
    });
  } finally { console.log = originalLog; }
  assert.equal(lines.length, 1);
  const record = lines[0];
  assert.equal(record.event, 'request');
  assert.equal(record.method, 'GET');
  assert.equal(record.status, 200);
  assert.equal(record.nested.count, 2);
  assert.equal(record.nested.token, '[redacted]');
  assert.equal(record.items[0].safe, 'ok');
  assert.equal(record.items[0].password, '[redacted]');
  assert.equal(record.apiKey, '[redacted]');
  assert.equal(record.message, '[redacted]');
});

test('the configured level still filters info events', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try { createLogger({ level: 'warn' }).info('ignored', { status: 200 }); }
  finally { console.log = originalLog; }
  assert.deepEqual(lines, []);
});
