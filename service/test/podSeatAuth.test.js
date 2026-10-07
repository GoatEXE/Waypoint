import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { DockerAdapter } from '../src/docker.js';
import { PodSeats } from '../src/podSeats.js';
import { KILL_LOGIN_SCRIPT, LOGIN_WRAPPER_SCRIPT, PodSeatAuth, WRITE_SEAT_ENV_KEY_SCRIPT } from '../src/podSeatAuth.js';

const POD_ID = 'pod_11111111-2222-4333-8444-555555555555';
const TEMPLATE_ID = 'tpl_11111111-2222-4333-8444-555555555555';
const MODEL = { provider: 'anthropic', default: 'claude-sonnet-5' };
const SECRET = 'sk-test-SHOULD-NEVER-LEAK-0123456789';

function config(dryRun = false) {
  return { ...loadConfig({ WAYPOINT_BRIDGE_TOKEN: 'a'.repeat(32), HERMES_AUTO_START: 'false' }, '/tmp'), dryRun };
}
function instance(overrides = {}) {
  return { id: POD_ID, podName: 'web-squad', templateId: TEMPLATE_ID, seats: [{ id: 'lead', role: 'Lead' }, { id: 'coder', role: 'Coder' }], ...overrides };
}
function readyProfile(seatId, extra = {}) {
  return { seatId, state: 'ready', identity: true, writable: true, envPresent: true, envPrivate: true, missingSubdirs: [], foreignOwned: 0, symlinks: 0, changed: [], seatAuthFile: false, model: { ...MODEL, api_mode: '', baseUrlSet: false }, ...extra };
}
function mockRunner({ podId = POD_ID, profile = (seat) => readyProfile(seat.id), scriptCode = 0, killResults = undefined } = {}) {
  const calls = [];
  const names = { container: `waypoint-pod-${POD_ID.replace('_', '-')}`, volume: `waypoint-pod-data-${POD_ID.replace('_', '-')}` };
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    assert.equal(command, 'docker');
    if (args[0] === 'inspect') return { code: 0, stdout: JSON.stringify({
      owned: 'true', podId, running: true, image: config().docker.image,
      mounts: [{ Type: 'volume', Name: names.volume, Destination: '/opt/data' }],
      privileged: false, portBindings: {}, capAdd: null, networkMode: 'bridge', networks: { bridge: {} },
    }), stderr: '' };
    if (args[0] === 'volume') return { code: 0, stdout: JSON.stringify({ owned: 'true', podId, name: names.volume, driver: 'local', options: {} }), stderr: '' };
    if (args.includes('python3')) {
      const payload = JSON.parse(options.input || '{}');
      if (payload.loginId) {
        const next = Array.isArray(killResults) && killResults.length ? killResults.shift() : { code: 0, stdout: '{"ok":true,"terminated":true}\n', stderr: '' };
        return next;
      }
      if (payload.key) return { code: scriptCode, stdout: scriptCode ? '' : '{"ok":true}\n', stderr: scriptCode ? SECRET : '' };
      return { code: 0, stdout: JSON.stringify({ rootOk: true, podRootAuthFile: true, seats: payload.seats.map((seat) => profile(seat)) }), stderr: '' };
    }
    throw new Error(`unexpected docker call: ${args.join(' ')}`);
  };
  return { runner, calls, names };
}
class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = new EventEmitter();
    this.stdinWrites = [];
    this.stdin.write = (value) => { this.stdinWrites.push(String(value)); return true; };
    this.stdin.end = () => {};
    this.killed = [];
  }
  kill(signal) { this.killed.push(signal); this.emit('killed', signal); return true; }
  close(code = 0) { this.emit('close', code); }
}
function harness(options = {}) {
  const cfg = config(options.dryRun === true);
  if (options.timeoutSeconds != null) cfg.hermes.loginTimeoutSeconds = options.timeoutSeconds;
  const mock = mockRunner(options.runner || {});
  const docker = new DockerAdapter(cfg);
  const podSeats = new PodSeats({ config: cfg, docker, runner: mock.runner });
  const children = [];
  const spawns = [];
  const logs = [];
  const spawner = (command, args, spawnOptions) => {
    const child = new FakeChild();
    children.push(child);
    spawns.push({ command, args, options: spawnOptions });
    return child;
  };
  const auth = new PodSeatAuth({ config: cfg, docker, podSeats, spawner, logger: { info: (event, fields) => logs.push({ level: 'info', event, fields }), warn: (event, fields) => logs.push({ level: 'warn', event, fields }) } });
  return { cfg, mock, docker, podSeats, auth, children, spawns, logs };
}
function assertNoSecret(value) {
  assert.equal(JSON.stringify(value).includes(SECRET), false);
}
function emitMarker(child, login, pid = 4321, pgid = 4321) {
  child.stdout.emit('data', `${JSON.stringify({ waypointLogin: { id: login.id, seatId: login.seatId, provider: login.provider, pid, pgid } })}\n`);
}
function emitComplete(child, login, code = 0) {
  child.stdout.emit('data', `\n${JSON.stringify({ waypointLoginComplete: { id: login.id, seatId: login.seatId, provider: login.provider, code } })}\n`);
}
async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
}
async function waitForCancel(auth, id) {
  for (let i = 0; i < 20; i += 1) {
    const promise = auth.logins.get(id)?.cancelPromise;
    if (promise) return promise;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return auth.getLogin(POD_ID, 'lead', 'anthropic', id);
}
function findPython() {
  for (const command of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return command;
  }
  return '';
}

test('rejects dry-run, wrong pod ownership, and wrong seat before auth exec', async () => {
  const dry = harness({ dryRun: true });
  await assert.rejects(dry.auth.startLogin(instance(), 'lead', 'anthropic'), /DRY_RUN=false/);
  assert.equal(dry.mock.calls.length, 0);
  assert.equal(dry.spawns.length, 0);

  const wrongSeat = harness();
  await assert.rejects(wrongSeat.auth.startLogin(instance(), 'ghost', 'anthropic'), /does not belong/);
  assert.equal(wrongSeat.mock.calls.length, 0);
  assert.equal(wrongSeat.spawns.length, 0);

  const wrongPod = harness({ runner: { podId: 'pod_99999999-2222-4333-8444-555555555555' } });
  await assert.rejects(wrongPod.auth.startLogin(instance(), 'lead', 'anthropic'), /ownership labels/);
  assert.deepEqual(wrongPod.mock.calls.map((call) => call.args[0]), ['inspect']);
  assert.equal(wrongPod.spawns.length, 0);

  const notReady = harness({ runner: { profile: (seat) => readyProfile(seat.id, { state: 'needs_provision', envPrivate: false }) } });
  await assert.rejects(notReady.auth.saveApiKey(instance(), 'lead', 'anthropic', { apiKey: SECRET }), /profile is not ready/);
  assert.equal(notReady.mock.calls.some((call) => call.options.input?.includes(SECRET)), false);
});

test('starts Anthropic authorization-code login, accepts code via stdin, authorizes terminally, and retains terminal state for TTL', async () => {
  const h = harness();
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  assert.equal(started.state, 'pending');
  assert.equal(started.requiresCode, true);
  assert.equal(h.spawns.length, 1);
  assert.deepEqual(h.spawns[0].args.slice(0, 6), ['exec', '-i', '--user', 'hermes', h.mock.names.container, 'python3']);
  assert.equal(h.spawns[0].args.includes(LOGIN_WRAPPER_SCRIPT), true);
  assert.deepEqual(JSON.parse(h.spawns[0].args.at(-1)), { loginId: started.id, seatId: 'lead', provider: 'anthropic', timeoutSeconds: h.cfg.hermes.loginTimeoutSeconds });

  emitMarker(h.children[0], started);
  h.children[0].stdout.emit('data', 'Docs https://example.com/not-auth first. Open https://claude.ai/oauth/authorize?state=abc\nAuthorization code: ');
  const pending = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(pending.state, 'pending');
  assert.equal(pending.authUrl, 'https://claude.ai/oauth/authorize?state=abc');
  assert.equal(pending.requiresCode, true);
  const submitted = h.auth.submitLoginCode(POD_ID, 'lead', 'anthropic', started.id, { code: 'auth-code-123' });
  assert.equal(submitted.state, 'pending');
  assert.deepEqual(h.children[0].stdinWrites, ['auth-code-123\n']);

  emitComplete(h.children[0], started, 0);
  h.children[0].close(0);
  const done = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(done.state, 'authorized');
  assert.equal(done.authUrl, '');
  assert.equal(done.userCode, '');
  const retained = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(retained.state, 'authorized');
  h.auth.logins.get(started.id).terminalAt = Date.now() - (6 * 60 * 1000);
  assert.throws(() => h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id), /login not found/);
  assertNoSecret({ spawns: h.spawns, logs: h.logs, done });
});

test('parses Codex device-code login without false failure from Ctrl-C help and records provider failures safely', async () => {
  const h = harness();
  const started = await h.auth.startLogin(instance(), 'lead', 'openai-codex');
  emitMarker(h.children[0], started);
  h.children[0].stdout.emit('data', 'To sign in visit https://auth.openai.com/device\nEnter this code: ABCD-EFGH\nPress Ctrl-C to cancel\n');
  const pending = h.auth.getLogin(POD_ID, 'lead', 'openai-codex', started.id);
  assert.equal(pending.state, 'pending');
  assert.equal(pending.userCode, 'ABCD-EFGH');
  assert.equal(pending.authUrl, 'https://auth.openai.com/device');

  h.children[0].stderr.emit('data', 'oauth invalid_grant expired');
  const observed = h.auth.getLogin(POD_ID, 'lead', 'openai-codex', started.id);
  assert.equal(observed.state, 'pending');
  assert.match(observed.message, /Waiting for Hermes to exit/);
  emitComplete(h.children[0], started, 1);
  h.children[0].close(1);
  const failed = h.auth.getLogin(POD_ID, 'lead', 'openai-codex', started.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.authUrl, '');
  assert.equal(failed.userCode, '');
  assert.match(failed.message, /rejected or expired/);
  assertNoSecret({ spawns: h.spawns, logs: h.logs, failed });
});

test('does not spawn duplicate pending login for the same pod seat provider', async () => {
  const h = harness();
  const first = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  const second = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  assert.equal(second.id, first.id);
  assert.equal(h.spawns.length, 1);
  const otherSeat = await h.auth.startLogin(instance(), 'coder', 'anthropic');
  assert.notEqual(otherSeat.id, first.id);
  assert.equal(h.spawns.length, 2);
});

test('cancel uses a validated in-container kill before reporting cancelled', async () => {
  const h = harness();
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  emitMarker(h.children[0], started, 777, 777);
  const cancelling = h.auth.cancelLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(cancelling.state, 'cancelling');
  await waitForCancel(h.auth, started.id);
  const cancelled = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(cancelled.state, 'cancelled');
  const killCall = h.mock.calls.find((call) => call.args.includes(KILL_LOGIN_SCRIPT));
  assert.ok(killCall, 'container-side kill script ran');
  assert.deepEqual(killCall.args.slice(0, 6), ['exec', '-i', '--user', 'hermes', h.mock.names.container, 'python3']);
  assert.deepEqual(JSON.parse(killCall.options.input), { loginId: started.id, seatId: 'lead', provider: 'anthropic', pid: 777, pgid: 777 });
  assert.equal(h.children[0].killed.length, 0, 'host docker exec was not used as the cancellation mechanism');
});

test('cancel before PID marker retries automatically when the marker arrives', async () => {
  const h = harness();
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  const cancelling = h.auth.cancelLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(cancelling.state, 'cancelling');
  await waitForCancel(h.auth, started.id);
  assert.equal(h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id).state, 'cancelling');
  assert.equal(h.mock.calls.some((call) => call.args.includes(KILL_LOGIN_SCRIPT)), false, 'no false kill without marker');
  emitMarker(h.children[0], started, 889, 889);
  await waitForCancel(h.auth, started.id);
  const cancelled = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(cancelled.state, 'cancelled');
  const killCall = h.mock.calls.find((call) => call.args.includes(KILL_LOGIN_SCRIPT));
  assert.ok(killCall, 'marker arrival retried container-side kill');
  assert.deepEqual(JSON.parse(killCall.options.input), { loginId: started.id, seatId: 'lead', provider: 'anthropic', pid: 889, pgid: 889 });
  assert.equal(h.children[0].killed.length, 0, 'host docker exec was not killed');
});

test('cancel before PID marker becomes terminal when wrapper later confirms nonzero exit', async () => {
  const h = harness();
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  h.auth.cancelLogin(POD_ID, 'lead', 'anthropic', started.id);
  await waitForCancel(h.auth, started.id);
  emitComplete(h.children[0], started, 1);
  h.children[0].close(1);
  const cancelled = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.match(cancelled.message, /Cancellation confirmed/);
  assert.equal(h.mock.calls.some((call) => call.args.includes(KILL_LOGIN_SCRIPT)), false, 'no kill without marker was needed once wrapper exit was confirmed');
});

test('docker exec disconnect with a known in-container PID triggers kill and fails closed', async () => {
  const h = harness();
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  emitMarker(h.children[0], started, 990, 990);
  h.children[0].close(1);
  await waitForCancel(h.auth, started.id);
  const failed = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.message, /disconnected/);
  const killCall = h.mock.calls.find((call) => call.args.includes(KILL_LOGIN_SCRIPT));
  assert.ok(killCall, 'disconnect triggered in-container kill');
  assert.deepEqual(JSON.parse(killCall.options.input), { loginId: started.id, seatId: 'lead', provider: 'anthropic', pid: 990, pgid: 990 });
});

test('marker-disappeared kill race can still terminal from wrapper completion marker', async () => {
  const h = harness({ runner: { killResults: [{ code: 3, stdout: '', stderr: '' }] } });
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  emitMarker(h.children[0], started, 991, 991);
  h.auth.cancelLogin(POD_ID, 'lead', 'anthropic', started.id);
  await waitForCancel(h.auth, started.id);
  assert.equal(h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id).state, 'cancelling');
  emitComplete(h.children[0], started, 1);
  h.children[0].close(1);
  const cancelled = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(cancelled.state, 'cancelled');
});

test('repeated cancel while cancelling retries a bounded in-container kill when PID is known', async () => {
  const h = harness({ runner: { killResults: [{ code: 0, stdout: '{"ok":true,"terminated":false}\n', stderr: '' }, { code: 0, stdout: '{"ok":true,"terminated":true}\n', stderr: '' }] } });
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  emitMarker(h.children[0], started, 992, 992);
  h.auth.cancelLogin(POD_ID, 'lead', 'anthropic', started.id);
  await waitForCancel(h.auth, started.id);
  assert.equal(h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id).state, 'cancelling');
  h.auth.cancelLogin(POD_ID, 'lead', 'anthropic', started.id);
  await waitForCancel(h.auth, started.id);
  const cancelled = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(h.mock.calls.filter((call) => call.args.includes(KILL_LOGIN_SCRIPT)).length, 2);
});

test('unconfirmed cancellation remains non-terminal and blocks duplicate starts', async () => {
  const h = harness({ runner: { killResults: [{ code: 0, stdout: '{"ok":true,"terminated":false}\n', stderr: '' }] } });
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  emitMarker(h.children[0], started, 888, 888);
  h.auth.cancelLogin(POD_ID, 'lead', 'anthropic', started.id);
  await waitForCancel(h.auth, started.id);
  const stillCancelling = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(stillCancelling.state, 'cancelling');
  assert.match(stillCancelling.message, /not yet confirmed/);
  const duplicate = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  assert.equal(duplicate.id, started.id);
  assert.equal(h.spawns.length, 1);
});

test('timeout requests container-side termination and reports failed only after confirmation', async () => {
  const h = harness({ timeoutSeconds: -4.99 });
  const started = await h.auth.startLogin(instance(), 'lead', 'anthropic');
  emitMarker(h.children[0], started, 999, 999);
  await waitForCancel(h.auth, started.id);
  const timedOut = h.auth.getLogin(POD_ID, 'lead', 'anthropic', started.id);
  assert.equal(timedOut.state, 'failed');
  assert.match(timedOut.message, /timed out/);
  const killCall = h.mock.calls.find((call) => call.args.includes(KILL_LOGIN_SCRIPT));
  assert.ok(killCall, 'timeout used container-side kill script');
});

test('API-key fallback writes only through stdin to the seat .env and never argv/log/response', async () => {
  const h = harness();
  const saved = await h.auth.saveApiKey(instance(), 'lead', 'openai', { apiKey: SECRET });
  assert.deepEqual(saved, { podId: POD_ID, seatId: 'lead', provider: 'openai-api', configured: true, credentialPresent: true, authMode: 'api-key', message: 'API key saved to the seat profile .env. Readiness is verified by Hermes when a provider request is made.' });
  assertNoSecret(saved);
  assertNoSecret(h.logs);
  for (const call of h.mock.calls) assertNoSecret({ command: call.command, args: call.args });
  const keyCall = h.mock.calls.find((call) => call.options.input?.includes(SECRET));
  assert.ok(keyCall, 'secret is supplied on stdin to the writer');
  assert.deepEqual(keyCall.args.slice(0, 6), ['exec', '-i', '--user', 'hermes', h.mock.names.container, 'python3']);
  assert.equal(JSON.parse(keyCall.options.input).value, SECRET);
  assert.equal(keyCall.options.timeoutMs > 0 && keyCall.options.timeoutMs <= 20000, true);
  assert.equal(keyCall.options.outputLimitBytes <= 16384, true);
  await assert.rejects(h.auth.saveApiKey(instance(), 'lead', 'openai-codex', { apiKey: SECRET }), /API-key fallback/);
});

test('login wrapper pump forwards short prompt and short code without waiting for 4096 bytes or stdin EOF', async (t) => {
  const python = findPython();
  if (!python) { t.skip('python unavailable'); return; }
  assert.doesNotMatch(LOGIN_WRAPPER_SCRIPT, /\.read\(4096\)/);
  assert.match(LOGIN_WRAPPER_SCRIPT, /os\.read\(src_fd,4096\)/);
  assert.match(LOGIN_WRAPPER_SCRIPT, /def terminate_child\(\):/);
  assert.match(LOGIN_WRAPPER_SCRIPT, /kill_on_eof/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-login-pump-'));
  try {
    const childPath = path.join(dir, 'child.py');
    const seenPath = path.join(dir, 'seen.txt');
    const wrapperPath = path.join(dir, 'wrapper.py');
    const orchestratorPath = path.join(dir, 'orchestrator.py');
    await fs.writeFile(childPath, `import sys\nsys.stdout.write('PROMPT> ')\nsys.stdout.flush()\ncode=sys.stdin.readline().strip()\nopen(${JSON.stringify(seenPath)},'w',encoding='utf-8').write(code)\nsys.stdout.write('DONE:'+code+'\\n')\nsys.stdout.flush()\n`, 'utf8');
    await fs.writeFile(wrapperPath, `import os, subprocess, sys, threading\nproc=subprocess.Popen([sys.executable, ${JSON.stringify(childPath)}],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)\ndef pump_fd(src_fd,dst_fd,close_dst=False):\n try:\n  while True:\n   data=os.read(src_fd,4096)\n   if not data: break\n   view=memoryview(data)\n   while view:\n    written=os.write(dst_fd,view)\n    view=view[written:]\n except OSError:\n  pass\n finally:\n  if close_dst:\n   try: os.close(dst_fd)\n   except OSError: pass\nthreads=[threading.Thread(target=pump_fd,args=(proc.stdout.fileno(),sys.stdout.fileno()),daemon=True),threading.Thread(target=pump_fd,args=(proc.stderr.fileno(),sys.stderr.fileno()),daemon=True),threading.Thread(target=pump_fd,args=(sys.stdin.fileno(),proc.stdin.fileno(),True),daemon=True)]\nfor t in threads: t.start()\nraise SystemExit(proc.wait())\n`, 'utf8');
    await fs.writeFile(orchestratorPath, `import os, subprocess, sys, threading, time\nproc=subprocess.Popen([sys.executable, ${JSON.stringify(wrapperPath)}],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)\nbuf=bytearray(); err=bytearray(); lock=threading.Lock()\ndef reader(pipe,target):\n try:\n  while True:\n   chunk=os.read(pipe.fileno(),4096)\n   if not chunk: break\n   with lock: target.extend(chunk)\n except OSError:\n  pass\nthreading.Thread(target=reader,args=(proc.stdout,buf),daemon=True).start()\nthreading.Thread(target=reader,args=(proc.stderr,err),daemon=True).start()\ndef snapshot():\n with lock: return bytes(buf), bytes(err)\ndef wait_for(needle,label,seconds=15):\n deadline=time.time()+seconds\n while True:\n  out,serr=snapshot()\n  if needle in out: return out\n  if proc.poll() is not None: raise SystemExit('wrapper exited before %s stdout=%r stderr=%r'%(label,out,serr))\n  if time.time()>deadline: raise SystemExit('%s timeout stdout=%r stderr=%r'%(label,out,serr))\n  time.sleep(0.01)\nwait_for(b'PROMPT> ','prompt')\nos.write(proc.stdin.fileno(),b'abc123\\n')\n# Deliberately keep stdin open until DONE; the short line must reach the child without EOF.\nout=wait_for(b'DONE:abc123','done')\n# Keep stdin open until wrapper exits; EOF before completion is the disconnect path.\ncode=proc.wait(timeout=5)\nout,serr=snapshot()\nif code!=0: raise SystemExit('wrapper code %s stdout=%r stderr=%r'%(code,out,serr))\nprint(out.decode('utf-8','replace'))\n`, 'utf8');
    const child = spawn(python, [orchestratorPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`wrapper pump timed out; stdout=${stdout} stderr=${stderr}`));
      }, 20000);
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`orchestrator exited ${code}; stdout=${stdout} stderr=${stderr}`));
      });
    });
    assert.match(stdout, /PROMPT> DONE:abc123/);
    assert.equal(await fs.readFile(seenPath, 'utf8'), 'abc123');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('seat API-key writer is scoped and private by construction', () => {
  assert.match(WRITE_SEAT_ENV_KEY_SCRIPT, /\/opt\/data\/profiles/);
  assert.match(WRITE_SEAT_ENV_KEY_SCRIPT, /WAYPOINT_SEAT\.json/);
  assert.match(WRITE_SEAT_ENV_KEY_SCRIPT, /stat\.S_ISREG/);
  assert.match(WRITE_SEAT_ENV_KEY_SCRIPT, /stat\.S_ISLNK/);
  assert.match(WRITE_SEAT_ENV_KEY_SCRIPT, /stat\.S_IMODE\(est\.st_mode\) & 0o077/);
  assert.match(WRITE_SEAT_ENV_KEY_SCRIPT, /os\.environ\['HERMES_HOME'\]=profile/);
  assert.match(WRITE_SEAT_ENV_KEY_SCRIPT, /save_provider_env_credential\(key,value\)/);
  assert.match(WRITE_SEAT_ENV_KEY_SCRIPT, /os\.chmod\(env_path,0o600\)/);
  assert.match(KILL_LOGIN_SCRIPT, /stat_line/);
  assert.match(KILL_LOGIN_SCRIPT, /=='Z'/);
  assert.doesNotMatch(WRITE_SEAT_ENV_KEY_SCRIPT, /waypoint-hermes-ceo|auth\.json|docker|chown|shutil/);
});
