import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesRuntime } from '../src/hermes.js';
import { loadConfig } from '../src/config.js';
import { runtimeFailure } from '../src/errors.js';

const DOCKER_DOWN = 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?';
const WINDOWS_DOWN = 'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/containers/json": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.';

test('Docker and stopped-CEO CLI failures map to plain errors', () => {
  assert.equal(runtimeFailure({ stderr: DOCKER_DOWN }).code, 'docker_unavailable');
  assert.equal(runtimeFailure({ stderr: WINDOWS_DOWN }).code, 'docker_unavailable');
  assert.equal(runtimeFailure({ stderr: 'spawn docker ENOENT' }).code, 'docker_unavailable');
  assert.equal(runtimeFailure({ stderr: 'Error response from daemon: container abc is not running' }).code, 'ceo_stopped');
  assert.equal(runtimeFailure({ stderr: 'Error: No such container: waypoint-hermes-ceo' }).code, 'ceo_stopped');
  assert.equal(runtimeFailure({ stderr: 'task t_1 not found' }), null);
  assert.equal(runtimeFailure({ stderr: DOCKER_DOWN }).message.includes('daemon'), false);
});

test('CEO status resolves to docker_unavailable instead of failing when Docker is down', async () => {
  const runner = async () => ({ code: 1, stdout: '', stderr: DOCKER_DOWN });
  const hermes = new HermesRuntime(loadConfig({}, '/tmp'), undefined, runner);
  const status = await hermes.status({ nativeAuth: 'fresh' });
  assert.deepEqual(status.runtime, { state: 'docker_unavailable', running: false });
  await assert.rejects(hermes.start(), (error) => error.code === 'docker_unavailable');
});

test('commands against a stopped CEO report ceo_stopped', async () => {
  const runner = async (_command, args) => args[0] === 'inspect'
    ? { code: 0, stdout: '{"owned":"true","id":"c1","state":"exited","running":false}\n', stderr: '' }
    : { code: 1, stdout: '', stderr: 'Error response from daemon: container c1 is not running' };
  const hermes = new HermesRuntime(loadConfig({}, '/tmp'), undefined, runner);
  await assert.rejects(hermes.execPython('print(1)', ''), (error) => error.code === 'ceo_stopped');
});

test('lifecycle start route starts the CEO', async () => {
  const calls = [];
  const runner = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'inspect') return { code: 1, stdout: '', stderr: 'No such object: waypoint-hermes-ceo' };
    return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
  };
  const hermes = new HermesRuntime(loadConfig({}, '/tmp'), undefined, runner);
  const result = await hermes.lifecycle('start');
  assert.equal(result.executed, true);
  assert.ok(calls.some((args) => args[0] === 'run'));
});
