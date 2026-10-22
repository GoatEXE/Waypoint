import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { loadConfig } from '../src/config.js';
import { HermesRuntime } from '../src/hermes.js';
import { NativeHost, runtimeFromLauncher } from '../src/hermesHost.js';
import { runtimeFailure } from '../src/errors.js';

async function nativeConfig(env = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-native-'));
  return loadConfig({ DATA_DIR: dir, HERMES_BIN: 'hermes-test', HERMES_PYTHON: 'python-test', ...env }, dir);
}

test('Waypoint uses its own Hermes home and a loopback bridge', async () => {
  const config = await nativeConfig();
  assert.equal(config.hermes.home, path.join(config.dataDir, 'hermes-home'));
  assert.equal(config.bridge.baseUrl, `http://127.0.0.1:${config.port}/bridge/tools`);
});

test('native commands run the Hermes binary with HERMES_HOME set on every call', async () => {
  const config = await nativeConfig({ WAYPOINT_HERMES_HOME: 'custom-home' });
  const host = new NativeHost(config);
  const command = host.hermes(['kanban', 'list']);
  assert.equal(command.command, 'hermes-test');
  assert.deepEqual(command.args, ['kanban', 'list']);
  assert.equal(command.options.env.HERMES_HOME, path.join(config.dataDir, 'custom-home'));
  const python = host.python('print(1)', ['a']);
  assert.equal(python.command, 'python-test');
  assert.deepEqual(python.args, ['-X', 'utf8', '-c', 'print(1)', 'a']);
  assert.equal(python.options.env.HERMES_HOME, host.home);
});

test('native seats reach GitHub only through the Waypoint shim, with a Waypoint git identity', async () => {
  const config = await nativeConfig();
  const host = new NativeHost(config);
  const env = host.env();
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
  assert.equal(env[pathKey].split(path.delimiter)[0], path.join(config.hermes.home, 'waypoint', 'bin'));
  assert.equal(env.WAYPOINT_BRIDGE_FILE, path.join(config.hermes.home, 'waypoint', 'bridge.json'));
  assert.equal(env.GIT_CONFIG_GLOBAL, path.join(config.hermes.home, 'home', '.gitconfig'));
  assert.deepEqual([env.GIT_CONFIG_COUNT, env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_VALUE_0], ['3', 'credential.https://github.com.helper', ''], 'inherited github.com helpers are reset first');
  assert.match(env.GIT_CONFIG_VALUE_1, /^!"python-test" ".*\/waypoint_github\.py" credential$/);
  host.installShims();
  const wrapper = await fs.readFile(path.join(host.binDir, process.platform === 'win32' ? 'gh.cmd' : 'gh'), 'utf8');
  assert.match(wrapper, /waypoint_github\.py" gh /);
  assert.deepEqual(host.gh(['repo', 'clone', 'a/b']).args.slice(1), ['gh', 'repo', 'clone', 'a/b']);
});

test('helper scripts reuse the bootstrap printed by the Hermes launcher', () => {
  const printed = JSON.stringify(['C:\\hermes\\python.exe', '-I', '-c', "import sys; sys.path.insert(0, 'C:\\\\hermes\\\\agent'); import hermes_bootstrap; runpy.run_module('hermes_cli.main', run_name='__main__', alter_sys=True)"]);
  assert.deepEqual(runtimeFromLauncher(`warming up\n${printed}\n`), { python: 'C:\\hermes\\python.exe', flags: ['-I', '-X', 'utf8'], prelude: "import sys; sys.path.insert(0, 'C:\\\\hermes\\\\agent'); import hermes_bootstrap; " });
  assert.equal(runtimeFromLauncher('not json'), null);
  assert.equal(runtimeFromLauncher(JSON.stringify(['python', '-c', 'print(1)'])), null);
});

test('a CEO turn runs hermes chat in the Waypoint home', async () => {
  const config = await nativeConfig();
  const spawns = [];
  const spawner = (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    spawns.push({ command, args, options });
    setImmediate(() => { child.stdout.write('{"type":"result","session_id":"s1","text":"Hello."}\n'); child.emit('close', 0); });
    return child;
  };
  const hermes = new HermesRuntime(config, undefined, async () => ({ code: 0, stdout: '', stderr: '' }), spawner);
  const result = await hermes.runCeoChat('Hi', null);
  assert.equal(result.reply, 'Hello.');
  assert.equal(spawns[0].command, 'hermes-test');
  assert.equal(spawns[0].args[0], 'chat');
  assert.equal(spawns[0].args[spawns[0].args.indexOf('--in') + 1], config.hermes.home);
  assert.equal(spawns[0].options.env.HERMES_HOME, config.hermes.home);
});

test('native status reports the gateway and a missing Hermes install', async () => {
  const config = await nativeConfig();
  const running = new HermesRuntime(config, undefined, async (command, args) => {
    if (args.some((arg) => String(arg).includes('get_running_pid'))) return { code: 0, stdout: '\n4242\n', stderr: ''};
    return { code: 0, stdout: '{}', stderr: ''};
  });
  const inspected = await running.inspect();
  assert.deepEqual(inspected, { exists: true, state: { state: 'running', running: true, pid: 4242 } });

  const stopped = new HermesRuntime(config, undefined, async () => ({ code: 0, stdout: '\n0\n', stderr: ''}));
  assert.equal((await stopped.inspect()).state.running, false);

  const missing = new HermesRuntime(config, undefined, async () => ({ code: 127, stdout: '', stderr: 'spawn hermes-test ENOENT'}));
  const status = await missing.status();
  assert.equal(status.home, config.hermes.home);
  assert.equal(status.runtime.state, 'hermes_unavailable');
  assert.equal(runtimeFailure({ code: 127, stderr: 'spawn hermes ENOENT' }).code, 'hermes_unavailable');
  assert.equal(runtimeFailure({ code: 1, stderr: 'some ENOENT path' }), null);
});
