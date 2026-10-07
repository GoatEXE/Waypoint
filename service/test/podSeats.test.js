import test from 'node:test';
import assert from 'node:assert/strict';
import { DockerAdapter } from '../src/docker.js';
import { loadConfig, PINNED_HERMES_IMAGE } from '../src/config.js';
import { PodSeats, SEAT_PROFILE_SCRIPT, assertSeatId, normalizeSeatModel, parseAuthStatus, resolveSeatModel } from '../src/podSeats.js';

const POD_ID = 'pod_11111111-2222-4333-8444-555555555555';
const TEMPLATE_ID = 'tpl_11111111-2222-4333-8444-555555555555';
const SECRET = 'sk-test-SHOULD-NEVER-LEAK-0123456789';
const MODEL = { provider: 'anthropic', default: 'claude-sonnet-5' };

function config(dryRun = false) {
  return { ...loadConfig({ WAYPOINT_BRIDGE_TOKEN: 'a'.repeat(32) }, '/tmp'), dryRun };
}
function instance(overrides = {}) {
  return { id: POD_ID, podName: 'web-squad', templateId: TEMPLATE_ID, seats: [{ id: 'lead', role: 'Lead' }, { id: 'coder', role: 'Coder' }], ...overrides };
}
function template(model = MODEL) {
  return { id: TEMPLATE_ID, config: { purpose: 'test', model } };
}
function readyProfile(seatId, extra = {}) {
  return { seatId, state: 'ready', identity: true, writable: true, envPresent: true, envPrivate: true, missingSubdirs: [], foreignOwned: 0, symlinks: 0, changed: [], seatAuthFile: false, model: { ...MODEL, api_mode: '', baseUrlSet: false }, ...extra };
}
function safeContainer(names, overrides = {}) {
  return {
    owned: 'true',
    podId: POD_ID,
    running: true,
    image: PINNED_HERMES_IMAGE,
    mounts: [{ Type: 'volume', Name: names.volume, Destination: '/opt/data', RW: true }],
    privileged: false,
    portBindings: {},
    capAdd: null,
    networkMode: 'bridge',
    networks: { bridge: {} },
    ...overrides,
  };
}
function safeVolume(names, overrides = {}) {
  return { owned: 'true', podId: POD_ID, name: names.volume, driver: 'local', options: {}, ...overrides };
}

function mockRunner({ container = {}, volume = {}, profiles, authText = (provider) => `${provider}: logged in\n  auth_type: oauth\n`, scriptCode = 0 } = {}) {
  const calls = [];
  const names = { container: `waypoint-pod-${POD_ID.replace('_', '-')}`, volume: `waypoint-pod-data-${POD_ID.replace('_', '-')}` };
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    assert.equal(command, 'docker');
    if (args[0] === 'inspect') {
      if (container.missing) return { code: 1, stdout: '', stderr: `Error: No such object: ${args.at(-1)}` };
      return { code: 0, stdout: JSON.stringify(safeContainer(names, container)), stderr: '' };
    }
    if (args[0] === 'volume') return { code: 0, stdout: JSON.stringify(safeVolume(names, volume)), stderr: '' };
    if (args.includes('python3')) {
      const payload = JSON.parse(options.input);
      const seats = profiles ? profiles(payload) : payload.seats.map((seat) => readyProfile(seat.id));
      return { code: scriptCode, stdout: `noise\n${JSON.stringify({ rootOk: true, podRootAuthFile: false, seats })}\n`, stderr: scriptCode ? `Traceback ${SECRET}` : '' };
    }
    if (args.includes('auth')) {
      const provider = args.at(-1);
      return { code: 0, stdout: authText(provider), stderr: '' };
    }
    throw new Error(`unexpected docker call: ${args.join(' ')}`);
  };
  return { runner, calls, names };
}
function seats(cfg = config(), mock = mockRunner()) {
  return new PodSeats({ config: cfg, docker: new DockerAdapter(cfg), runner: mock.runner });
}

test('refuses containers and volumes without matching Waypoint ownership before any exec', async () => {
  const cases = [
    [{ container: { podId: 'pod_99999999-2222-4333-8444-555555555555' } }, /ownership labels/],
    [{ container: { owned: '' } }, /ownership labels/],
    [{ container: { mounts: [{ Type: 'bind', Name: '', Destination: '/opt/data' }] } }, /Waypoint-owned volume/],
    [{ container: { mounts: [{ Type: 'volume', Name: 'waypoint-hermes-ceo-home', Destination: '/opt/data' }] } }, /Waypoint-owned volume/],
    [{ volume: { podId: '' } }, /volume without matching/],
    [{ container: { running: false } }, /not running/],
    [{ container: { missing: true } }, /not running/],
  ];
  for (const [options, message] of cases) {
    const mock = mockRunner(options);
    await assert.rejects(seats(config(), mock).provision(instance(), { template: template() }), message);
    assert.equal(mock.calls.some((call) => call.args[0] === 'exec'), false, `no exec for ${JSON.stringify(options)}`);
  }
});

test('verifyPod fails closed for unsafe container shape and bind-backed volumes before exec', async () => {
  const cases = [
    [{ container: { image: 'nousresearch/hermes-agent:latest' } }, /unexpected image/],
    [{ container: { mounts: [] } }, /unexpected mounts/],
    [{ container: { privileged: true } }, /privileged/],
    [{ container: { portBindings: { '8080/tcp': [{ HostPort: '8080' }] } } }, /published ports/],
    [{ container: { capAdd: ['SYS_ADMIN'] } }, /added capabilities/],
    [{ container: { networkMode: 'none', networks: { none: {} } } }, /network mode/],
    [{ container: { networks: { bridge: {}, extra: {} } } }, /Docker networks/],
    [{ container: { networks: null } }, /Docker networks/],
    [{ volume: { options: { type: 'none', o: 'bind', device: '/tmp/pod' } } }, /unsafe pod volume/],
  ];
  for (const [options, message] of cases) {
    const mock = mockRunner(options);
    await assert.rejects(seats(config(), mock).inspect(instance(), { template: template(), seatIds: ['lead'] }), message);
    assert.equal(mock.calls.some((call) => call.args[0] === 'exec'), false, `no exec for ${JSON.stringify(options)}`);
  }
});

test('rejects invalid, reserved, unknown, and excessive seat ids before touching Docker', async () => {
  for (const bad of ['default', 'hermes', 'test', 'tmp', 'root', 'sudo', 'waypoint-ceo', 'auth', '../ceo', 'Lead', 'a', '', 'x'.repeat(64), 'lead;rm']) {
    assert.throws(() => assertSeatId(bad), /seat id/, bad);
  }
  assert.equal(assertSeatId('lead_2'), 'lead_2');
  const mock = mockRunner();
  const pod = seats(config(), mock);
  await assert.rejects(pod.provision(instance({ seats: [{ id: 'default' }] })), /reserved/);
  await assert.rejects(pod.provision(instance(), { seatIds: ['reviewer'] }), /does not belong/);
  await assert.rejects(pod.provision(instance(), { seatIds: 'lead' }), /must be an array/);
  await assert.rejects(pod.provision(instance(), { seatIds: [] }), /must not be empty/);
  await assert.rejects(pod.provision(instance({ id: 'pod_../../x' })), /invalid pod id/);
  await assert.rejects(pod.provision(instance(), { template: { ...template(), id: 'tpl_other' } }), /template does not match/);
  assert.equal(mock.calls.length, 0);
});

test('uses --user hermes argv arrays scoped to the pod container and never the CEO home', async () => {
  const mock = mockRunner();
  const result = await seats(config(), mock).provision(instance(), { template: template() });
  assert.equal(result.ready, true);
  const execs = mock.calls.filter((call) => call.args[0] === 'exec');
  assert.ok(execs.length >= 3);
  for (const call of mock.calls) {
    assert.ok(Array.isArray(call.args));
    assert.ok(call.options.timeoutMs > 0 && call.options.timeoutMs <= 30000, 'bounded timeout');
    assert.ok(call.options.outputLimitBytes > 0 && call.options.outputLimitBytes <= 65536, 'bounded output');
    assert.equal(call.args.some((arg) => /waypoint-hermes-ceo/.test(arg)), false);
  }
  for (const call of execs) {
    assert.deepEqual(call.args.slice(call.args.indexOf('--user'), call.args.indexOf('--user') + 3), ['--user', 'hermes', mock.names.container]);
    assert.equal(call.args.includes('root'), false);
  }
  const authCalls = execs.filter((call) => call.args.includes('auth')).map((call) => call.args.slice(-5));
  assert.deepEqual(authCalls, [['-p', 'lead', 'auth', 'status', 'anthropic'], ['-p', 'coder', 'auth', 'status', 'anthropic']]);
  assert.equal(execs.some((call) => call.args.includes('profile') && call.args.includes('create')), false, 'never calls hermes profile create on seeded dirs');
});

test('dry-run returns a plan without inspecting or changing the pod', async () => {
  const mock = mockRunner();
  const result = await seats(config(true), mock).provision(instance(), { template: template() });
  assert.equal(result.dryRun, true);
  assert.equal(result.executed, false);
  assert.equal(mock.calls.length, 0);
  assert.equal(result.plan.steps.at(-1).args.at(-1), 'anthropic');
});

test('only non-secret model fields reach the container, with seat > instance > template precedence', async () => {
  assert.deepEqual(resolveSeatModel({ instance: instance(), template: template(), seat: {} }), { source: 'template', value: { ...MODEL, api_mode: '', base_url: '' } });
  assert.equal(resolveSeatModel({ instance: instance({ model: { provider: 'openai', default: 'gpt-5' } }), template: template(), seat: {} }).value.provider, 'openai-api');
  assert.equal(resolveSeatModel({ instance: instance(), template: template(), seat: { model: { provider: 'openai-codex', default: 'gpt-5-codex' } } }).source, 'seat');
  assert.deepEqual(resolveSeatModel({ instance: instance(), seat: {} }), { source: 'none', value: null });
  for (const bad of [
    { ...MODEL, api_key: SECRET },
    { ...MODEL, authToken: SECRET },
    { ...MODEL, temperature: 0.2 },
    { ...MODEL, base_url: `https://user:${SECRET}@example.com/v1` },
    { ...MODEL, base_url: `https://example.com/v1?key=${SECRET}` },
    { ...MODEL, base_url: 'file:///opt/data/auth.json' },
    { provider: 'ceo', default: 'x' },
    { provider: 'anthropic', default: 'bad model id' },
    'claude-sonnet-5',
  ]) assert.throws(() => normalizeSeatModel(bad), /seat model|unsupported provider/);

  const mock = mockRunner();
  await assert.rejects(seats(config(), mock).provision(instance(), { template: template({ ...MODEL, api_key: SECRET }) }), (error) => {
    assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes(SECRET), false);
    return /secret-like/.test(error.message);
  });
  assert.equal(mock.calls.length, 0);

  const ok = mockRunner();
  await seats(config(), ok).provision(instance(), { template: template({ ...MODEL, base_url: 'https://api.example.com/v1' }) });
  const script = ok.calls.find((call) => call.args.includes('python3'));
  assert.deepEqual(JSON.parse(script.options.input).seats[0], { id: 'lead', model: { ...MODEL, api_mode: '', base_url: 'https://api.example.com/v1' } });
});

test('subprocess output never propagates into results or errors', async () => {
  const leaky = mockRunner({
    authText: (provider) => `${provider}: logged in\n  access_token: ${SECRET}\n`,
    profiles: (payload) => payload.seats.map((seat) => ({ ...readyProfile(seat.id), reason: 'ok', apiKey: SECRET, envContents: SECRET, model: { ...MODEL, api_key: SECRET, base_url: SECRET, api_mode: '', baseUrlSet: true } })),
  });
  const result = await seats(config(), leaky).provision(instance(), { template: template() });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(result.seats[0].auth.providers.anthropic.authenticated, true);
  assert.equal(result.seats[0].model.current.baseUrlSet, true);

  const failing = mockRunner({ scriptCode: 1 });
  await assert.rejects(seats(config(), failing).provision(instance(), { template: template() }), (error) => {
    assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes(SECRET), false);
    return /seat profile check failed/.test(error.message);
  });
});

test('provision is idempotent and serialized per pod', async () => {
  let applied = false;
  let inFlight = 0;
  let maxInFlight = 0;
  const mock = mockRunner({
    profiles: (payload) => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); inFlight -= 1;
      const changed = applied ? [] : ['memories/', '.env', 'config.yaml:model'];
      applied = true;
      return payload.seats.map((seat) => readyProfile(seat.id, { changed }));
    },
  });
  const pod = seats(config(), mock);
  const [first, second] = await Promise.all([pod.provision(instance(), { template: template() }), pod.provision(instance(), { template: template() })]);
  assert.equal(maxInFlight, 1);
  assert.equal(first.changed, true);
  assert.deepEqual(first.seats[0].profile.changed, ['memories/', '.env', 'config.yaml:model']);
  assert.equal(second.changed, false);
  assert.deepEqual(second.seats.map((seat) => seat.ready), [true, true]);
  assert.equal(pod.locks.size, 0);
});

test('readiness requires a private .env, a writable profile, the applied model, and native auth', async () => {
  const mock = mockRunner({
    profiles: (payload) => payload.seats.map((seat) => (seat.id === 'lead'
      ? readyProfile(seat.id, { state: 'not_writable', writable: false, foreignOwned: 3, envPrivate: false })
      : readyProfile(seat.id, { model: null }))),
    authText: (provider) => `${provider}: logged out (no credentials)\n`,
  });
  const result = await seats(config(), mock).provision(instance(), { template: template() });
  const [lead, coder] = result.seats;
  assert.equal(result.ready, false);
  assert.deepEqual(lead.blockers, ['profile_not_writable', 'auth_not_ready']);
  assert.equal(lead.auth.providers.anthropic.state, 'skipped');
  assert.deepEqual(coder.blockers, ['model_not_applied', 'auth_not_ready']);
  assert.equal(coder.auth.providers.anthropic.state, 'logged_out');
  assert.equal(mock.calls.filter((call) => call.args.includes('auth')).length, 1, 'auth is not probed for a non-writable seat');
});

test('inspect is read-only and checks all supported providers when no model is configured', async () => {
  const mock = mockRunner({ profiles: (payload) => payload.seats.map((seat) => readyProfile(seat.id, { model: null })) });
  const result = await seats(config(), mock).inspect(instance(), { seatIds: ['coder'] });
  const script = mock.calls.find((call) => call.args.includes('python3'));
  assert.deepEqual(JSON.parse(script.options.input), { mode: 'inspect', seats: [{ id: 'coder', model: null }] });
  assert.deepEqual(Object.keys(result.seats[0].auth.providers), ['openai-codex', 'anthropic', 'openai-api']);
  assert.deepEqual(result.seats[0].blockers, ['model_unconfigured']);
  const noAuth = mockRunner();
  await seats(config(), noAuth).inspect(instance(), { checkAuth: false, providers: ['openai'] });
  assert.equal(noAuth.calls.some((call) => call.args.includes('auth')), false);
});

test('parses native auth status by provider line only', () => {
  assert.equal(parseAuthStatus('anthropic: logged in\n  auth_type: oauth\n', 'anthropic').authenticated, true);
  assert.equal(parseAuthStatus('\x1b[32manthropic: logged in\x1b[0m', 'anthropic').authenticated, true);
  assert.equal(parseAuthStatus('anthropic: logged out (expired)', 'anthropic').state, 'logged_out');
  assert.equal(parseAuthStatus('openai-codex: logged in', 'anthropic').state, 'unknown');
  assert.equal(parseAuthStatus('anthropic: free tier\n  upgrade', 'anthropic').authenticated, false);
  assert.equal(parseAuthStatus('', 'anthropic').state, 'unknown');
});

test('profile script keeps the 0600/hermes-owned contract and never reads credential files', () => {
  assert.match(SEAT_PROFILE_SCRIPT, /os\.O_EXCL/);
  assert.match(SEAT_PROFILE_SCRIPT, /0o600\)/);
  assert.match(SEAT_PROFILE_SCRIPT, /st\.st_uid==uid/);
  assert.match(SEAT_PROFILE_SCRIPT, /followlinks=False/);
  assert.match(SEAT_PROFILE_SCRIPT, /atomic_config_write/);
  assert.doesNotMatch(SEAT_PROFILE_SCRIPT, /(?<!os\.)open\(env|open\(os\.path\.join\([^)]*auth\.json|chown|profile create|shutil/);
});
