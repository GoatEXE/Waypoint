import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { HermesRuntime } from '../src/hermes.js';
import { loadConfig } from '../src/config.js';
import { runtimeFailure } from '../src/errors.js';

async function config() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-health-'));
  return loadConfig({ HERMES_PYTHON: 'python', DATA_DIR: dir }, dir);
}

test('a missing Hermes command maps to a plain error', () => {
  assert.equal(runtimeFailure({ code: 127, stderr: 'spawn hermes ENOENT' }).code, 'hermes_unavailable');
  assert.match(runtimeFailure({ code: 127, stderr: 'spawn hermes ENOENT' }).message, /Install Hermes/);
  assert.equal(runtimeFailure({ code: 1, stderr: 'task t_1 not found' }), null);
});

test('CEO status resolves to hermes_unavailable instead of failing when Hermes is missing', async () => {
  const runner = async () => ({ code: 127, stdout: '', stderr: 'spawn hermes ENOENT' });
  const hermes = new HermesRuntime(await config(), undefined, runner);
  const status = await hermes.status({ nativeAuth: 'fresh' });
  assert.deepEqual(status.runtime, { state: 'hermes_unavailable', running: false });
  await assert.rejects(hermes.start(), (error) => error.code === 'hermes_unavailable');
});

test('lifecycle start route starts the CEO gateway', async () => {
  const calls = [];
  let running = false;
  const runner = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'python' && String(args.at(-1)).includes('get_running_pid')) return { code: 0, stdout: `\n${running ? 4242 : 0}\n`, stderr: '' };
    return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
  };
  const spawner = (command, args) => {
    calls.push([command, ...args]);
    running = true;
    return Object.assign(new EventEmitter(), { unref() {} });
  };
  const hermes = new HermesRuntime(await config(), undefined, runner, spawner);
  const result = await hermes.lifecycle('start');
  assert.equal(result.executed, true);
  assert.ok(calls.some((call) => call.join(' ') === 'hermes gateway run --replace --quiet'));
});
