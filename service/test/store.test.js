import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PodStore } from '../src/store.js';
import { DockerAdapter } from '../src/docker.js';
import { loadConfig, PINNED_HERMES_IMAGE } from '../src/config.js';

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-pod-')); }
function volumeName(podId) { return `waypoint-pod-data-${podId.replaceAll('_', '-')}`; }
function containerName(podId) { return `waypoint-pod-${podId.replaceAll('_', '-')}`; }
function planFactory({ podId }) { return { command: 'docker', args: ['run', '--mount', `type=volume,source=${volumeName(podId)},target=/opt/data`], labels: {}, volumeName: volumeName(podId), containerName: containerName(podId) }; }
function safeVolumeJson(podId, overrides = {}) {
  return JSON.stringify({ owned: 'true', podId, name: volumeName(podId), driver: 'local', options: {}, ...overrides });
}
function safeContainerJson(podId, overrides = {}) {
  return JSON.stringify({
    owned: 'true',
    podId,
    id: 'c1',
    state: 'exited',
    running: false,
    image: PINNED_HERMES_IMAGE,
    mounts: [{ Type: 'volume', Name: volumeName(podId), Destination: '/opt/data', RW: true }],
    privileged: false,
    portBindings: {},
    capAdd: null,
    networkMode: 'bridge',
    networks: { bridge: {} },
    ...overrides,
  });
}

const templateInput = {
  name: 'research pod',
  version: '2026.10.0',
  seats: [
    { id: 'coder', role: 'implementation', instructions: 'write code' },
    { id: 'reviewer', role: 'review', instructions: 'review code' },
  ],
  baselineFiles: {
    'SOUL.md': 'shared operating guidance',
    'memories/MEMORY.md': 'approved baseline memory',
    'skills/research/SKILL.md': 'skill notes',
  },
  config: { apiEnabled: false },
};

test('cloned pods and seats have independent writable profile copies', async () => {
  const store = new PodStore(await tmp());
  await store.ensure();
  const template = await store.createTemplate(templateInput);
  const one = await store.cloneTemplate(template.id, { podName: 'alpha' }, planFactory);
  const two = await store.cloneTemplate(template.id, { podName: 'beta' }, planFactory);
  assert.notEqual(one.id, two.id);

  const oneCoderSoul = path.join(one.instanceDir, 'profiles', 'coder', 'SOUL.md');
  const oneReviewerSoul = path.join(one.instanceDir, 'profiles', 'reviewer', 'SOUL.md');
  const twoCoderSoul = path.join(two.instanceDir, 'profiles', 'coder', 'SOUL.md');
  await fs.writeFile(oneCoderSoul, 'changed by alpha coder');
  assert.equal(await fs.readFile(oneReviewerSoul, 'utf8'), 'shared operating guidance');
  assert.equal(await fs.readFile(twoCoderSoul, 'utf8'), 'shared operating guidance');
  assert.equal(JSON.parse(await fs.readFile(path.join(one.instanceDir, 'profiles', 'coder', 'WAYPOINT_SEAT.json'), 'utf8')).instructions, 'write code');
  assert.equal((await store.getInstance(one.id)).templateVersion, '2026.10.0');
});

test('template persistence survives a new store instance', async () => {
  const dataDir = await tmp();
  const first = new PodStore(dataDir);
  await first.ensure();
  const template = await first.createTemplate(templateInput);
  const second = new PodStore(dataDir);
  const reloaded = await second.getTemplate(template.id);
  assert.equal(reloaded.name, 'research pod');
  assert.equal(reloaded.seats.length, 2);
  assert.ok(reloaded.baselineFiles['skills/research/SKILL.md']);
});

test('tasks record pod and seat ownership without claiming execution', async () => {
  const store = new PodStore(await tmp());
  await store.ensure();
  const template = await store.createTemplate(templateInput);
  const instance = await store.cloneTemplate(template.id, { podName: 'gamma' }, planFactory);
  const task = await store.createTask({ podId: instance.id, seatId: 'coder', summary: 'Draft design' });
  assert.equal(task.state, 'delegated');
  assert.equal(task.podId, instance.id);
  assert.equal(task.seatId, 'coder');
  assert.deepEqual(task.evidence, [], 'creating a task records no evidence');
  await assert.rejects(() => store.createTask({ podId: instance.id, seatId: 'missing', summary: 'bad' }), /seat does not belong/);
});

test('baseline allowlist excludes clone artifacts and secret-like metadata keys', async () => {
  const store = new PodStore(await tmp());
  await store.ensure();
  await assert.rejects(() => store.createTemplate({ ...templateInput, baselineFiles: { '.env': 'BWS_ACCESS_TOKEN=x' } }), /not allowlisted/);
  await assert.rejects(() => store.createTemplate({ ...templateInput, config: { BWS_ACCESS_TOKEN: 'x' } }), /secret-like keys/);
});

test('resource ids, pod names, and Hermes reserved profile names are constrained', async () => {
  const store = new PodStore(await tmp());
  await store.ensure();
  const template = await store.createTemplate(templateInput);
  await assert.rejects(() => store.getTemplate('../outside'), /invalid resource id/);
  for (const id of ['default', 'hermes-agent', 'test', 'tmp', 'sudo']) {
    await assert.rejects(() => store.createTemplate({ ...templateInput, seats: [{ id, role: 'bad' }] }), /reserved/, id);
  }
  await assert.rejects(() => store.cloneTemplate(template.id, { podName: 'shared' }, planFactory), /reserved/);
  await store.cloneTemplate(template.id, { podName: 'same' }, planFactory);
  await assert.rejects(() => store.cloneTemplate(template.id, { podName: 'same' }, planFactory), /podName already exists/);
});

test('stored pod manifests cannot steer derived host paths or Docker bind plans', async () => {
  const dataDir = await tmp();
  const store = new PodStore(dataDir);
  await store.ensure();
  const template = await store.createTemplate(templateInput);
  const instance = await store.cloneTemplate(template.id, { podName: 'safe-pod' }, planFactory);
  const manifestPath = path.join(dataDir, 'instances', instance.id, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.instanceDir = path.join(os.tmpdir(), 'attacker-controlled');
  manifest.profilesDir = path.join(os.tmpdir(), 'attacker-controlled', 'profiles');
  manifest.seats[0].profileDir = path.join(os.tmpdir(), 'attacker-controlled', 'profiles', 'coder');
  manifest.dockerPlan = { command: 'docker', args: ['run', '--mount', 'type=bind,source=/host/escape,target=/opt/data'] };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const reloaded = await store.getInstance(instance.id, { dockerPlanFactory: planFactory });
  assert.equal(reloaded.instanceDir, path.join(dataDir, 'instances', instance.id));
  assert.equal(reloaded.profilesDir, path.join(dataDir, 'instances', instance.id, 'profiles'));
  assert.equal(reloaded.seats[0].profileDir, path.join(dataDir, 'instances', instance.id, 'profiles', 'coder'));
  assert.equal(reloaded.dockerPlan.volumeName, volumeName(instance.id));
  assert.equal(JSON.stringify(reloaded.dockerPlan).includes('type=bind'), false);
  assert.equal(reloaded.planSource, 'derived-from-service-config');
});

test('lifecycle recording replaces stale bind plans without claiming dry-run execution', async () => {
  const dataDir = await tmp();
  const store = new PodStore(dataDir);
  await store.ensure();
  const template = await store.createTemplate(templateInput);
  const instance = await store.cloneTemplate(template.id, { podName: 'record-pod' }, planFactory);
  const manifestPath = path.join(dataDir, 'instances', instance.id, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.dockerPlan = { command: 'docker', args: ['run', '--mount', 'type=bind,source=/bad,target=/opt/data'] };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const dry = await store.recordLifecycle(instance.id, { action: 'start', dryRun: true, executed: false, status: { state: 'running', running: true } }, planFactory);
  assert.equal(dry.state, 'planned');
  assert.equal(dry.lifecycle.dryRun, true);
  assert.equal(JSON.stringify(dry.dockerPlan).includes('type=bind'), false);
  const liveStatus = await store.recordLifecycle(instance.id, { action: 'status', dryRun: false, executed: true, status: { state: 'running', running: true } }, planFactory);
  assert.equal(liveStatus.state, 'running');
  assert.equal(liveStatus.dockerPlan.volumeName, volumeName(instance.id));
});

test('docker lifecycle dry-run uses a named volume plan and redacts inspect scope', async () => {
  const config = loadConfig({ DRY_RUN: 'true' }, '/tmp');
  const docker = new DockerAdapter(config);
  const instance = { id: 'pod_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', podName: 'alpha', instanceDir: '/tmp/waypoint data/pod' };
  const dry = await docker.lifecycle(instance, 'start');
  assert.equal(dry.executed, false);
  assert.equal(dry.dryRun, true);
  assert.match(dry.message, /no Hermes task executed/);
  assert.ok(dry.plan.args.includes('--mount'));
  assert.ok(dry.plan.args.includes(`type=volume,source=${volumeName(instance.id)},target=/opt/data`));
  assert.equal(JSON.stringify(dry.plan).includes('type=bind'), false);
  assert.equal(dry.plan.args.some((arg) => String(arg).includes('docker.sock')), false);
  assert.equal(dry.plan.args.some((arg) => String(arg).includes('WAYPOINT_BRIDGE_TOKEN') || String(arg).includes('bridge-token')), false);
  assert.deepEqual(dry.plan.args.slice(dry.plan.args.indexOf('--network'), dry.plan.args.indexOf('--network') + 2), ['--network', 'bridge']);
  assert.equal(dry.plan.network.outbound, true);
  assert.equal(dry.plan.network.publishedPorts, false);
  assert.equal(dry.plan.imagePinned, true);
  assert.deepEqual(dry.plan.startup.argv, ['sleep', 'infinity']);

  const status = await docker.lifecycle(instance, 'status');
  assert.equal(status.plan.redacted, true);
  assert.equal(status.plan.args.join(' ').includes('Config.Env'), false);
  const stop = await docker.lifecycle(instance, 'stop');
  assert.deepEqual(stop.plan.args, ['stop', containerName(instance.id)]);
});

test('docker live mode checks ownership and starts an existing owned stopped container idempotently', async () => {
  const liveConfig = loadConfig({ DRY_RUN: 'false' }, '/tmp');
  const instance = { id: 'pod_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', podName: 'alpha' };
  const cname = containerName(instance.id);
  const vname = volumeName(instance.id);
  const unowned = new DockerAdapter(liveConfig, undefined, async () => ({ code: 0, stdout: '{"owned":"true","podId":"different","id":"c1","state":"exited","running":false}\n', stderr: 'secret-ish' }));
  await assert.rejects(() => unowned.lifecycle(instance, 'stop'), /refusing to operate/);
  const missingOwnedLabel = new DockerAdapter(liveConfig, undefined, async () => ({ code: 0, stdout: `${safeContainerJson(instance.id, { owned: '' })}\n`, stderr: '' }));
  await assert.rejects(() => missingOwnedLabel.lifecycle(instance, 'stop'), /ownership labels/);
  const inaccessible = new DockerAdapter(liveConfig, undefined, async () => ({ code: 1, stdout: '', stderr: 'permission denied while connecting to Docker daemon token=hidden' }));
  await assert.rejects(() => inaccessible.lifecycle(instance, 'status'), /container cannot be inspected/);
  const missing = new DockerAdapter(liveConfig, undefined, async () => ({ code: 1, stdout: '', stderr: `No such object: ${cname}` }));
  assert.equal((await missing.lifecycle(instance, 'status')).status.state, 'missing');

  const calls = [];
  let started = false;
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id)}\n`, stderr: '' };
    if (args[0] === 'inspect') return { code: 0, stdout: `${safeContainerJson(instance.id, started ? { state: 'running', running: true } : {})}\n`, stderr: '' };
    if (args[0] === 'exec' && args.at(-1).includes('.waypoint-volume-seeded')) return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'start') started = true;
    if (args[0] === 'stop') started = false;
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const live = new DockerAdapter(liveConfig, undefined, runner);
  const result = await live.lifecycle(instance, 'start');
  assert.equal(result.executed, true);
  assert.equal(result.status.running, true);
  assert.ok(calls.some(([, args]) => args[0] === 'start' && args[1] === cname));
  assert.equal(calls.some(([, args]) => args.includes('type=bind')), false);
  const stopped = await live.lifecycle(instance, 'stop');
  assert.equal(stopped.status.running, false);

  const runningCalls = [];
  const running = new DockerAdapter(liveConfig, undefined, async (command, args) => {
    runningCalls.push([command, args]);
    if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id)}\n`, stderr: '' };
    if (args[0] === 'inspect') return { code: 0, stdout: `${safeContainerJson(instance.id, { state: 'running', running: true })}\n`, stderr: '' };
    if (args[0] === 'exec' && args.at(-1).includes('.waypoint-volume-seeded')) return { code: 0, stdout: '', stderr: '' };
    throw new Error('running container start should only verify seed state');
  });
  assert.equal((await running.lifecycle(instance, 'start')).executed, false);
  assert.equal(runningCalls.some(([, args]) => args[0] === 'start' || args[0] === 'run'), false);
});

test('docker live start refuses unowned volumes and seeds newly created owned volumes', async () => {
  const liveConfig = loadConfig({ DRY_RUN: 'false' }, '/tmp');
  const instance = { id: 'pod_bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', podName: 'beta' };
  const vname = volumeName(instance.id);
  const unownedVolume = new DockerAdapter(liveConfig, undefined, async (command, args) => {
    if (args[0] === 'volume') return { code: 0, stdout: '{"owned":"true","podId":"other","name":"existing"}\n', stderr: '' };
    return { code: 0, stdout: '{}', stderr: '' };
  });
  await assert.rejects(() => unownedVolume.lifecycle(instance, 'start'), /refusing to use volume/);
  const missingOwnedVolume = new DockerAdapter(liveConfig, undefined, async (command, args) => {
    if (args[0] === 'volume') return { code: 0, stdout: `${safeVolumeJson(instance.id, { owned: '' })}\n`, stderr: '' };
    return { code: 0, stdout: '{}', stderr: '' };
  });
  await assert.rejects(() => missingOwnedVolume.lifecycle(instance, 'start'), /ownership labels/);

  const calls = [];
  let created = false;
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'volume' && args[1] === 'inspect' && calls.filter(([, a]) => a[0] === 'volume' && a[1] === 'inspect').length === 1) return { code: 1, stdout: '', stderr: `No such volume: ${vname}` };
    if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id)}\n`, stderr: '' };
    if (args[0] === 'inspect') return created
      ? { code: 0, stdout: `${safeContainerJson(instance.id, { state: 'running', running: true })}\n`, stderr: '' }
      : { code: 1, stdout: '', stderr: `No such object: ${containerName(instance.id)}` };
    if (args[0] === 'exec' && args.at(-1).includes('test -e')) return { code: 1, stdout: '', stderr: '' };
    if (args[0] === 'run') created = true;
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const live = new DockerAdapter(liveConfig, undefined, runner);
  const result = await live.lifecycle(instance, 'start');
  assert.equal(result.executed, true);
  assert.equal(result.status.running, true);
  assert.deepEqual(result.seed, { changed: true, marker: '/opt/data/.waypoint-volume-seeded' });
  assert.ok(calls.some(([, args]) => args[0] === 'volume' && args[1] === 'create' && args.includes(vname)));
  const runCall = calls.find(([, args]) => args[0] === 'run');
  assert.ok(runCall[1].includes(`type=volume,source=${vname},target=/opt/data`));
  assert.deepEqual(runCall[1].slice(runCall[1].indexOf('--network'), runCall[1].indexOf('--network') + 2), ['--network', 'bridge']);
  assert.equal(runCall[1].some((arg) => String(arg).includes('docker.sock') || String(arg).includes('type=bind') || String(arg).includes('WAYPOINT_BRIDGE_TOKEN')), false);
  const copyIndex = calls.findIndex(([, args]) => args[0] === 'cp' && String(args[1]).includes(`${path.sep}profiles${path.sep}.`) && String(args[1]).endsWith(`${path.sep}.`));
  const chownIndex = calls.findIndex(([, args]) => args[0] === 'exec' && args.includes('--user') && args.includes('root') && args.includes('chown') && args.includes('hermes:hermes') && args.includes('/opt/data/profiles'));
  assert.ok(copyIndex >= 0);
  assert.ok(chownIndex > copyIndex);
});

test('docker start refuses owned stopped containers with incompatible none network', async () => {
  const liveConfig = loadConfig({ DRY_RUN: 'false' }, '/tmp');
  const instance = { id: 'pod_cccccccc-cccc-4ccc-cccc-cccccccccccc', podName: 'netfix' };
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id)}\n`, stderr: '' };
    if (args[0] === 'inspect') return { code: 0, stdout: `${safeContainerJson(instance.id, { networkMode: 'none', networks: { none: {} } })}\n`, stderr: '' };
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const live = new DockerAdapter(liveConfig, undefined, runner);
  await assert.rejects(() => live.lifecycle(instance, 'start'), /incompatible Docker network mode/);
  assert.equal(calls.some(([, args]) => args[0] === 'rm' || args[0] === 'run' || args[0] === 'start'), false);
});

test('docker start retries seeding for an owned running container after a prior seed failure', async () => {
  const liveConfig = loadConfig({ DRY_RUN: 'false' }, '/tmp');
  const instance = { id: 'pod_dddddddd-dddd-4ddd-dddd-dddddddddddd', podName: 'seed-retry' };
  const cname = containerName(instance.id);
  const vname = volumeName(instance.id);
  const calls = [];
  let inspectMissing = true;
  let failFirstCopy = true;
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id)}\n`, stderr: '' };
    if (args[0] === 'inspect' && inspectMissing) { inspectMissing = false; return { code: 1, stdout: '', stderr: `No such object: ${cname}` }; }
    if (args[0] === 'inspect') return { code: 0, stdout: `${safeContainerJson(instance.id, { state: 'running', running: true })}\n`, stderr: '' };
    if (args[0] === 'exec' && args.at(-1).includes('test -e')) return { code: 1, stdout: '', stderr: '' };
    if (args[0] === 'cp' && failFirstCopy) { failFirstCopy = false; return { code: 1, stdout: '', stderr: 'copy failed without secrets' }; }
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const live = new DockerAdapter(liveConfig, undefined, runner);
  await assert.rejects(() => live.lifecycle(instance, 'start'), /could not be seeded/);
  const retry = await live.lifecycle(instance, 'start');
  assert.equal(retry.executed, false);
  assert.deepEqual(retry.seed, { changed: true, marker: '/opt/data/.waypoint-volume-seeded' });
  assert.equal(calls.filter(([, args]) => args[0] === 'run').length, 1);
  assert.ok(calls.some(([, args]) => args[0] === 'exec' && args.includes('chown') && args.includes('hermes:hermes')));
});

test('docker start fails closed for unsafe existing pod containers and bind-backed volumes', async () => {
  const liveConfig = loadConfig({ DRY_RUN: 'false' }, '/tmp');
  const instance = { id: 'pod_eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', podName: 'unsafe' };
  const cases = [
    ['unsafe mount', { mounts: [{ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/opt/data' }] }, /unsafe \/opt\/data mount|unexpected mounts/],
    ['wrong image', { image: 'nousresearch/hermes-agent:latest' }, /unexpected image/],
    ['privileged', { privileged: true }, /privileged/],
    ['ports', { portBindings: { '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] } }, /published ports/],
    ['capabilities', { capAdd: ['SYS_ADMIN'] }, /added capabilities/],
    ['malformed capabilities', { capAdd: 'SYS_ADMIN' }, /added capabilities/],
    ['extra network', { networks: { bridge: {}, other: {} } }, /incompatible Docker networks/],
    ['missing network', { networks: null }, /incompatible Docker networks/],
  ];
  for (const [name, override, pattern] of cases) {
    const calls = [];
    const runner = async (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id)}\n`, stderr: '' };
      if (args[0] === 'inspect') return { code: 0, stdout: `${safeContainerJson(instance.id, override)}\n`, stderr: '' };
      throw new Error(`${name} should fail before mutating Docker`);
    };
    const live = new DockerAdapter(liveConfig, undefined, runner);
    await assert.rejects(() => live.lifecycle(instance, 'start'), pattern, name);
    assert.equal(calls.some(([, args]) => ['run', 'start', 'rm', 'stop', 'cp', 'exec'].includes(args[0])), false, name);
  }

  const bindBacked = new DockerAdapter(liveConfig, undefined, async (command, args) => {
    if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id, { options: { type: 'none', o: 'bind', device: '/tmp/pod' } })}\n`, stderr: '' };
    throw new Error('bind-backed volume should fail before container inspect or mutation');
  });
  await assert.rejects(() => bindBacked.lifecycle(instance, 'start'), /unsafe pod volume/);
});

test('invalid boolean config values are rejected instead of enabling live mode', () => {
  assert.throws(() => loadConfig({ DRY_RUN: 'treu' }, '/tmp'), /DRY_RUN must be a boolean/);
});

test('local project folders are bind mounted and a running pod is recreated when its mounts change', async () => {
  const liveConfig = loadConfig({ DRY_RUN: 'false' }, '/tmp');
  const instance = { id: 'pod_cccccccc-cccc-4ccc-cccc-cccccccccccc', podName: 'gamma' };
  const cname = containerName(instance.id);
  const projectMounts = [{ projectId: 'project_11111111-1111-4111-8111-111111111111', source: 'E:/Repositories/goat-ops', target: '/opt/data/projects/project_11111111-1111-4111-8111-111111111111' }];
  const plan = new DockerAdapter(liveConfig).startPlan({ podId: instance.id, podName: 'gamma', projectMounts });
  assert.ok(plan.args.includes(`type=bind,source=E:/Repositories/goat-ops,target=${projectMounts[0].target},readonly`));
  assert.ok(plan.args.some((arg) => /^com\.waypoint\.pod\.project_mounts=[0-9a-f]{32}$/.test(arg) || arg.includes('.project_mounts=')));

  const calls = [];
  let recreated = false;
  const bind = { Type: 'bind', Source: '/run/desktop/mnt/host/e/Repositories/goat-ops', Destination: projectMounts[0].target, RW: true };
  const runner = async (command, args) => {
    calls.push(args);
    if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id)}\n`, stderr: '' };
    if (args[0] === 'inspect') return { code: 0, stdout: `${safeContainerJson(instance.id, recreated ? { state: 'running', running: true, mountsKey: 'x', mounts: [{ Type: 'volume', Name: volumeName(instance.id), Destination: '/opt/data', RW: true }, bind] } : { state: 'running', running: true })}\n`, stderr: '' };
    if (args[0] === 'exec') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'run') recreated = true;
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const result = await new DockerAdapter(liveConfig, undefined, runner).lifecycle(instance, 'start', { projectMounts });
  assert.equal(result.recreated, true);
  assert.deepEqual(calls.filter((args) => ['stop', 'rm', 'run'].includes(args[0])).map((args) => args[0]), ['stop', 'rm', 'run']);
  assert.ok(calls.find((args) => args[0] === 'run').includes(`type=bind,source=E:/Repositories/goat-ops,target=${projectMounts[0].target},readonly`));
  assert.equal(calls.find((args) => args[0] === 'rm')[1], cname);

  const foreignBind = new DockerAdapter(liveConfig, undefined, async (command, args) => {
    if (args[0] === 'volume' && args[1] === 'inspect') return { code: 0, stdout: `${safeVolumeJson(instance.id)}\n`, stderr: '' };
    if (args[0] === 'inspect') return { code: 0, stdout: `${safeContainerJson(instance.id, { mounts: [{ Type: 'volume', Name: volumeName(instance.id), Destination: '/opt/data', RW: true }, { Type: 'bind', Source: '/etc', Destination: '/opt/data/host-etc', RW: true }] })}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  });
  await assert.rejects(() => foreignBind.lifecycle(instance, 'start'), /unexpected mounts/);
});
