import { spawn } from 'node:child_process';
import { badRequest, conflict, lifecycleError } from './errors.js';
import { HERMES_RESERVED_PROFILE_NAMES } from './store.js';
import { verifySharedAuthVolume } from './authVolume.js';
import { isProjectBindMount } from './projectMounts.js';

export const CONTAINER_DATA_DIR = '/opt/data';
export const SEAT_PROFILE_ROOT = `${CONTAINER_DATA_DIR}/profiles`;
export const HERMES_PROFILE_SUBDIRS = ['memories', 'sessions', 'skills', 'skins', 'logs', 'plans', 'workspace', 'cron', 'home'];
export const POD_AUTH_PROVIDERS = ['openai-codex', 'anthropic', 'openai-api'];
export const MAX_SEATS_PER_CALL = 32;

const POD_ID_RE = /^pod_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEAT_ID_RE = /^[a-z][a-z0-9_-]{1,62}$/;

const RESERVED_SEAT_IDS = new Set([...HERMES_RESERVED_PROFILE_NAMES, 'hermes', 'default', 'test', 'tmp', 'root', 'sudo']);
const PROVIDER_ALIASES = { openai: 'openai-api' };
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const API_MODE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const SECRET_KEY_RE = /secret|token|password|credential|api[_-]?key|bws|auth/i;
const MODEL_FIELDS = new Set(['provider', 'default', 'api_mode', 'base_url']);
const PROFILE_STATES = new Set(['ready', 'needs_provision', 'not_seeded', 'not_writable', 'foreign', 'invalid', 'error']);
const CHANGE_TOKENS = new Set([...HERMES_PROFILE_SUBDIRS.map((dir) => `${dir}/`), '.env', 'mode:profile', 'mode:.env', 'mode:config.yaml', 'config.yaml:model']);
const EXEC_TIMEOUT_MS = 30000;
const AUTH_TIMEOUT_MS = 20000;
const SCRIPT_OUTPUT_LIMIT = 64 * 1024;
const AUTH_OUTPUT_LIMIT = 8 * 1024;

export class PodSeats {

  constructor({ config, docker, runner = boundedRunner, logger = undefined }) {
    this.config = config;
    this.docker = docker;
    this.runner = runner;
    this.logger = logger;
    this.locks = new Map();
  }

  async inspect(instance, options = {}) {
    return this.run(instance, options, 'inspect');
  }

  async provision(instance, options = {}) {
    const podId = assertPodId(instance?.id);
    const previous = this.locks.get(podId) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.run(instance, options, 'provision'));
    const tail = run.catch(() => {});
    this.locks.set(podId, tail);
    tail.then(() => { if (this.locks.get(podId) === tail) this.locks.delete(podId); });
    return run;
  }

  plan(instance, options = {}, mode = 'provision') {
    const target = this.resolveTarget(instance, options);
    return {
      containerName: target.containerName,
      volumeName: target.volumeName,
      steps: [
        { command: 'docker', args: ['inspect', '--format', '<ownership/state/mount format>', target.containerName], purpose: 'verify Waypoint-owned running pod container with its named volume at /opt/data' },
        { command: 'docker', args: ['volume', 'inspect', '--format', '<ownership format>', target.volumeName], purpose: 'verify Waypoint-owned pod volume' },
        { command: 'docker', args: ['exec', '-i', '--user', 'hermes', target.containerName, 'python3', '-c', '<seat profile script>'], purpose: `${mode} seat profiles under ${SEAT_PROFILE_ROOT}`, stdin: { mode, seats: target.seats.map((seat) => ({ id: seat.id, model: seat.model.value })) } },
        ...target.seats.flatMap((seat) => seat.authProviders.map((provider) => ({ command: 'docker', args: ['exec', '--user', 'hermes', target.containerName, 'hermes', '-p', seat.id, 'auth', 'status', provider], purpose: 'native per-seat auth readiness' }))),
      ],
    };
  }

  async run(instance, options, mode) {
    const target = this.resolveTarget(instance, options);
    if (this.config.dryRun) {
      const seats = target.seats.map((seat) => ({
        seatId: seat.id,
        profile: null,
        model: { source: seat.model.source, requested: requestedModel(seat.model.value), current: null, state: seat.model.value ? 'planned' : 'unconfigured' },
        auth: null,
        ready: false,
        blockers: ['dry_run', ...(seat.model.value ? [] : ['model_unconfigured'])],
      }));
      return { podId: target.podId, action: mode, dryRun: true, executed: false, changed: false, ready: false, seats, plan: this.plan(instance, options, mode), message: 'Dry-run only; no pod container was inspected or changed.' };
    }
    await this.verifyPod(target);
    const profiles = await this.execSeatScript(target, mode);
    const seats = [];
    for (const seat of target.seats) {
      const profile = profiles.get(seat.id) || { state: 'error', reason: 'seat missing from profile script output' };
      const auth = await this.seatAuth(target.containerName, seat, profile, options.checkAuth !== false);
      seats.push(seatResult(seat, profile, auth, profiles.podRootAuthFile));
    }
    const changed = seats.reduce((count, seat) => count + seat.profile.changed.length, 0);
    this.logger?.info?.('pod seats checked', { podId: target.podId, action: mode, seats: seats.length, changed });
    return {
      podId: target.podId,
      action: mode,
      dryRun: false,
      executed: true,
      containerName: target.containerName,
      volumeName: target.volumeName,
      changed: changed > 0,
      ready: seats.every((seat) => seat.ready),
      seats,
      notes: [
        this.config.sharedAuth?.enabled
          ? 'Provider auth uses the Waypoint shared auth volume, so the CEO and pod seats use one Hermes token store and refresh lock. Seat API keys in .env still take precedence.'
          : 'Provider auth is native to the pod volume: each seat uses its own profile auth.json, falling back to the pod-root auth.json.',
        'No model call or task execution was performed.',
      ],
    };
  }

  resolveTarget(instance, options = {}) {
    if (!instance || typeof instance !== 'object' || Array.isArray(instance)) throw badRequest('pod instance is required');
    const podId = assertPodId(instance.id);
    if (!Array.isArray(instance.seats) || instance.seats.length === 0) throw conflict('pod instance has no seats', { podId });
    const template = options.template;
    if (template != null && (typeof template !== 'object' || template.id !== instance.templateId)) throw badRequest('template does not match the pod instance', { podId });
    const byId = new Map();
    for (const seat of instance.seats) byId.set(assertSeatId(seat?.id), seat);
    const requested = options.seatIds == null ? [...byId.keys()] : [...new Set(asArray(options.seatIds, 'seatIds').map(assertSeatId))];
    if (requested.length === 0) throw badRequest('seatIds must not be empty');
    if (requested.length > MAX_SEATS_PER_CALL) throw badRequest('too many seats requested', { max: MAX_SEATS_PER_CALL });
    const providers = options.providers == null ? null : asArray(options.providers, 'providers').map(normalizeProvider);
    const seats = requested.map((seatId) => {
      const seat = byId.get(seatId);
      if (!seat) throw conflict('seat does not belong to pod', { podId, seatId });
      const model = resolveSeatModel({ instance, template, seat });
      const authProviders = providers || (model.value ? [model.value.provider] : POD_AUTH_PROVIDERS);
      return { id: seatId, model, authProviders: [...new Set(authProviders)] };
    });
    return { podId, containerName: this.docker.makeContainerName(podId), volumeName: this.docker.makeVolumeName(podId), seats };
  }

  async verifyPod({ podId, containerName, volumeName }) {
    const ns = this.config.docker.labelNamespace;
    const containerFormat = `{"owned":"{{ index .Config.Labels "${ns}.owned" }}","podId":"{{ index .Config.Labels "${ns}.pod_id" }}","running":{{.State.Running}},"image":"{{.Config.Image}}","mounts":{{json .Mounts}},"privileged":{{json .HostConfig.Privileged}},"portBindings":{{json .HostConfig.PortBindings}},"capAdd":{{json .HostConfig.CapAdd}},"networkMode":"{{.HostConfig.NetworkMode}}","networks":{{json .NetworkSettings.Networks}}}`;
    const container = await this.runner('docker', ['inspect', '--format', containerFormat, containerName], { timeoutMs: EXEC_TIMEOUT_MS, outputLimitBytes: AUTH_OUTPUT_LIMIT });
    if (container.code !== 0) {
      if (/No such object|No such container/i.test(container.stderr || '')) throw conflict('pod container is not running; start the pod first', { podId });
      throw lifecycleError('pod container could not be inspected', { podId, code: container.code });
    }
    const parsed = parseJsonLine(container.stdout, 'docker inspect returned an unexpected shape');
    if (parsed.owned !== 'true' || parsed.podId !== podId) throw lifecycleError('refusing to use container without matching Waypoint ownership labels', { podId });
    if (parsed.running !== true) throw conflict('pod container is not running; start the pod first', { podId });
    assertSafeExistingPodContainer(parsed, { podId, volumeName, image: this.config.docker.image, sharedAuth: this.config.sharedAuth });
    const volumeFormat = `{"owned":"{{ index .Labels "${ns}.owned" }}","podId":"{{ index .Labels "${ns}.pod_id" }}","name":"{{.Name}}","driver":"{{.Driver}}","options":{{json .Options}}}`;
    const volume = await this.runner('docker', ['volume', 'inspect', '--format', volumeFormat, volumeName], { timeoutMs: EXEC_TIMEOUT_MS, outputLimitBytes: AUTH_OUTPUT_LIMIT });
    if (volume.code !== 0) throw lifecycleError('pod volume could not be inspected as Waypoint-owned', { podId, code: volume.code });
    const vol = parseJsonLine(volume.stdout, 'docker volume inspect returned an unexpected shape');
    if (vol.owned !== 'true' || vol.podId !== podId) throw lifecycleError('refusing to use volume without matching Waypoint ownership labels', { podId });
    if (vol.name !== volumeName) throw lifecycleError('refusing to use volume whose inspected name does not match the expected pod volume', { podId });
    if (!isSafeDockerVolume(vol)) throw lifecycleError('refusing to use unsafe pod volume driver or options', { podId, driver: vol.driver || '' });
    await verifySharedAuthVolume(this.config, this.runner);
  }

  async execSeatScript(target, mode) {
    const input = JSON.stringify({ mode, seats: target.seats.map((seat) => ({ id: seat.id, model: mode === 'provision' ? seat.model.value : null })) });
    const result = await this.runner('docker', ['exec', '-i', '--user', 'hermes', target.containerName, 'python3', '-c', SEAT_PROFILE_SCRIPT], { input, timeoutMs: EXEC_TIMEOUT_MS, outputLimitBytes: SCRIPT_OUTPUT_LIMIT });
    if (result.timedOut) throw lifecycleError('seat profile check timed out', { podId: target.podId });
    if (result.code !== 0) throw lifecycleError('seat profile check failed in pod container', { podId: target.podId, code: result.code });
    const parsed = parseJsonLine(result.stdout, 'seat profile check returned an unexpected shape');
    if (!Array.isArray(parsed.seats)) throw lifecycleError('seat profile check returned an unexpected shape');
    const profiles = new Map();
    for (const raw of parsed.seats) {
      const seatId = String(raw?.seatId || '');
      if (target.seats.some((seat) => seat.id === seatId)) profiles.set(seatId, sanitizeProfile(raw));
    }
    profiles.podRootAuthFile = parsed.podRootAuthFile === true;
    if (parsed.rootOk !== true) for (const seat of target.seats) profiles.set(seat.id, { ...sanitizeProfile({}), state: 'not_seeded', reason: 'pod volume has no regular profiles directory' });
    return profiles;
  }

  async seatAuth(containerName, seat, profile, checkAuth) {
    const providers = {};
    for (const provider of seat.authProviders) {
      if (!checkAuth) providers[provider] = authStatus('not_checked', 'Auth status was not requested.');
      else if (!profile.identity || profile.state !== 'ready') providers[provider] = authStatus('skipped', 'Seat profile is not ready; auth status was not checked.');
      else providers[provider] = await this.nativeAuthStatus(containerName, seat.id, provider);
    }
    return providers;
  }

  async nativeAuthStatus(containerName, seatId, provider) {
    const result = await this.runner('docker', ['exec', '--user', 'hermes', containerName, 'hermes', '-p', seatId, 'auth', 'status', provider], { timeoutMs: AUTH_TIMEOUT_MS, outputLimitBytes: AUTH_OUTPUT_LIMIT });
    if (result.timedOut) return authStatus('unknown', 'Native auth status timed out.');
    if (result.code !== 0) return authStatus('unknown', 'Native auth status unavailable.');
    return parseAuthStatus(result.stdout, provider);
  }
}

export function resolveSeatModel({ instance = {}, template = undefined, seat = {} }) {
  const candidates = [['seat', seat.model], ['instance', instance.model], ['template', template?.config?.model]];
  for (const [source, value] of candidates) {
    if (value == null || value === '') continue;
    return { source, value: normalizeSeatModel(value, source) };
  }
  return { source: 'none', value: null };
}

export function normalizeSeatModel(input, source = 'model') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('seat model must be an object with provider and default', { source });
  for (const key of Object.keys(input)) {
    if (SECRET_KEY_RE.test(key)) throw badRequest('seat model must not contain secret-like fields', { source, field: key });
    if (!MODEL_FIELDS.has(key)) throw badRequest('seat model contains an unsupported field', { source, field: key });
  }
  const provider = normalizeProvider(input.provider);
  const defaultModel = String(input.default || '').trim();
  if (!MODEL_RE.test(defaultModel)) throw badRequest('seat model default has an invalid shape', { source });
  const apiMode = String(input.api_mode || '').trim();
  if (apiMode && !API_MODE_RE.test(apiMode)) throw badRequest('seat model api_mode has an invalid shape', { source });
  const baseUrl = String(input.base_url || '').trim();
  if (baseUrl) {
    let parsed;
    try { parsed = new URL(baseUrl); } catch { throw badRequest('seat model base_url must be a valid http(s) URL', { source }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest('seat model base_url must be a valid http(s) URL', { source });
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw badRequest('seat model base_url must not carry credentials, query, or fragment', { source });
  }
  return { provider, default: defaultModel, api_mode: apiMode, base_url: baseUrl };
}

export function assertSeatId(seatId) {
  const value = String(seatId ?? '');
  if (!SEAT_ID_RE.test(value)) throw badRequest('invalid seat id', { seatId: value.slice(0, 64) });
  if (RESERVED_SEAT_IDS.has(value)) throw badRequest('seat id is reserved by Hermes or Waypoint', { seatId: value });
  return value;
}

export function parseAuthStatus(stdout, provider) {
  const firstLine = String(stdout || '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const prefix = `${provider}:`;
  if (!firstLine.startsWith(prefix)) return authStatus('unknown', 'Native Hermes auth status was inconclusive.');
  const state = firstLine.slice(prefix.length).trim();
  if (state === 'logged in') return { checked: true, authenticated: true, state: 'authenticated', message: 'Native Hermes auth reports authenticated.' };
  if (state.startsWith('logged out')) return { checked: true, authenticated: false, state: 'logged_out', message: 'Not authenticated with native Hermes auth.' };
  return authStatus('unknown', 'Native Hermes auth status was inconclusive.');
}

function authStatus(state, message) {
  return { checked: false, authenticated: false, state, message };
}

export function publicSeatsResult(result) {
  const body = {
    podId: result.podId,
    action: result.action,
    dryRun: Boolean(result.dryRun),
    executed: Boolean(result.executed),
    changed: Boolean(result.changed),
    ready: Boolean(result.ready),
    seats: (result.seats || []).map((seat) => ({
      seatId: seat.seatId,
      ready: Boolean(seat.ready),
      blockers: [...seat.blockers],
      profile: seat.profile ? {
        state: seat.profile.state,
        identity: seat.profile.identity,
        writable: seat.profile.writable,
        envPrivate: seat.profile.envPrivate,
        missingSubdirs: [...seat.profile.missingSubdirs],
        changed: [...seat.profile.changed],
      } : null,
      model: { state: seat.model.state, source: seat.model.source, requested: seat.model.requested, current: seat.model.current },
      auth: seat.auth ? {
        providers: Object.fromEntries(Object.entries(seat.auth.providers).map(([provider, status]) => [provider, { checked: status.checked, authenticated: status.authenticated, state: status.state, message: status.message }])),
        seatAuthFile: Boolean(seat.auth.stores.seatAuthFile),
        podAuthFile: Boolean(seat.auth.stores.podRootAuthFile),
      } : null,
    })),
  };
  if (result.dryRun) {
    body.message = result.message;
    body.plan = { steps: result.plan.steps.map(({ command, args, purpose }) => ({ command, args: [...args], purpose })) };
  } else {
    body.notes = [...(result.notes || [])];
  }
  return body;
}

function requestedModel(value) {
  return value ? { provider: value.provider, default: value.default } : null;
}

function seatResult(seat, profile, auth, podRootAuthFile) {
  const model = { source: seat.model.source, requested: requestedModel(seat.model.value), current: profile.model };
  const want = seat.model.value;
  const have = profile.model;
  const matches = Boolean(want && have && have.provider === want.provider && have.default === want.default && have.apiMode === want.api_mode && have.baseUrlSet === Boolean(want.base_url));
  model.state = !seat.model.value ? (profile.model ? 'profile_only' : 'unconfigured') : matches ? 'configured' : 'pending';
  const blockers = [];
  if (profile.state !== 'ready') blockers.push(`profile_${profile.state}`);
  if (!seat.model.value) blockers.push('model_unconfigured');
  else if (!matches) blockers.push('model_not_applied');
  const provider = seat.model.value?.provider;
  if (provider && !auth[provider]?.authenticated) blockers.push('auth_not_ready');
  const { model: _currentModel, ...profileFields } = profile;
  return {
    seatId: seat.id,
    profile: { ...profileFields, path: `${SEAT_PROFILE_ROOT}/${seat.id}` },
    model,
    auth: { providers: auth, stores: { seatAuthFile: profile.seatAuthFile, podRootAuthFile } },
    ready: blockers.length === 0,
    blockers,
  };
}

function sanitizeProfile(raw = {}) {
  const model = raw.model && typeof raw.model === 'object' ? {
    provider: safeToken(raw.model.provider),
    default: safeToken(raw.model.default),
    apiMode: API_MODE_RE.test(String(raw.model.api_mode || '')) ? String(raw.model.api_mode) : '',
    baseUrlSet: raw.model.baseUrlSet === true,
  } : null;
  return {
    state: PROFILE_STATES.has(raw.state) ? raw.state : 'error',
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 160) : '',
    identity: raw.identity === true,
    writable: raw.writable === true,
    envPresent: raw.envPresent === true,
    envPrivate: raw.envPrivate === true,
    missingSubdirs: Array.isArray(raw.missingSubdirs) ? raw.missingSubdirs.filter((dir) => HERMES_PROFILE_SUBDIRS.includes(dir)) : [],
    foreignOwned: Number.isInteger(raw.foreignOwned) ? raw.foreignOwned : 0,
    symlinks: Number.isInteger(raw.symlinks) ? raw.symlinks : 0,
    changed: Array.isArray(raw.changed) ? raw.changed.filter((token) => CHANGE_TOKENS.has(token)) : [],
    seatAuthFile: raw.seatAuthFile === true,
    model,
  };
}

function safeToken(value) {
  const text = String(value || '');
  return MODEL_RE.test(text) ? text : text ? '[unrecognized]' : '';
}

function normalizeProvider(provider) {
  const value = String(provider || '').trim();
  const canonical = PROVIDER_ALIASES[value] || value;
  if (!POD_AUTH_PROVIDERS.includes(canonical)) throw badRequest('unsupported provider', { provider: value.slice(0, 64) });
  return canonical;
}

function assertPodId(podId) {
  const value = String(podId || '');
  if (!POD_ID_RE.test(value)) throw badRequest('invalid pod id');
  return value;
}

function asArray(value, field) {
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);
  return value;
}

function parseJsonLine(stdout, message) {
  const line = String(stdout || '').trim().split(/\r?\n/).reverse().find((text) => text.trim().startsWith('{'));
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {   }
  throw lifecycleError(message);
}

function assertSafeExistingPodContainer(parsed, { podId, volumeName, image, sharedAuth }) {
  if (!imageMatchesConfigured(parsed.image, image)) throw lifecycleError('refusing to use pod container with unexpected image', { podId });
  const expectAuth = sharedAuth?.enabled === true;
  const coreMounts = Array.isArray(parsed.mounts) ? parsed.mounts.filter((entry) => !isProjectBindMount(entry)) : null;
  if (!coreMounts || coreMounts.length !== (expectAuth ? 2 : 1)) throw lifecycleError('refusing to use pod container with unexpected mounts', { podId });
  const mount = parsed.mounts.find((entry) => entry.Destination === CONTAINER_DATA_DIR);
  if (!mount || mount.Type !== 'volume' || mount.Name !== volumeName || mount.Destination !== CONTAINER_DATA_DIR) throw lifecycleError('refusing to use pod container without its Waypoint-owned volume at /opt/data', { podId });
  if (expectAuth) {
    const auth = parsed.mounts.find((entry) => entry.Destination === sharedAuth.mountPath);
    if (!auth || auth.Type !== 'volume' || auth.Name !== sharedAuth.volumeName || auth.RW !== true) throw lifecycleError('refusing to use pod container without the shared provider volume', { podId });
  }
  if (parsed.privileged !== false) throw lifecycleError('refusing to use privileged pod container', { podId });
  if (!isPlainObject(parsed.portBindings) || Object.keys(parsed.portBindings).length !== 0) throw lifecycleError('refusing to use pod container with published ports', { podId });
  if (parsed.capAdd != null && (!Array.isArray(parsed.capAdd) || parsed.capAdd.length !== 0)) throw lifecycleError('refusing to use pod container with added capabilities', { podId });
  if (parsed.networkMode !== 'bridge') throw lifecycleError('refusing to use pod container with incompatible Docker network mode', { podId });
  const networks = normalizeNetworkNames(parsed.networks);
  if (!Array.isArray(networks) || networks.length !== 1 || networks[0] !== 'bridge') throw lifecycleError('refusing to use pod container with incompatible Docker networks', { podId });
}

function imageMatchesConfigured(actual, expected) {
  const a = String(actual || '');
  const e = String(expected || '');
  if (!a || !e) return false;
  if (a === e) return true;
  return e.includes('@sha256:') && a.endsWith(`/${e}`);
}
function normalizeNetworkNames(networks) {
  if (!isPlainObject(networks)) return null;
  return Object.keys(networks).filter((name) => typeof name === 'string').sort();
}
function isSafeDockerVolume(vol) {
  if (vol.driver !== 'local') return false;
  if (vol.options == null) return true;
  return isPlainObject(vol.options) && Object.keys(vol.options).length === 0;
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function boundedRunner(command, args, options = {}) {
  return new Promise((resolve) => {
    const limit = options.outputLimitBytes || AUTH_OUTPUT_LIMIT;
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const cap = (current, chunk) => (current.length >= limit ? current : (current + chunk).slice(0, limit));
    child.stdout.on('data', (chunk) => { stdout = cap(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = cap(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
    }, options.timeoutMs || EXEC_TIMEOUT_MS);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, timedOut });
    };
    child.on('error', () => finish({ code: 127, stdout, stderr: 'command could not be started' }));
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(options.input || '');
  });
}

export const SEAT_PROFILE_SCRIPT = String.raw`
import json, os, re, stat, sys
from pathlib import Path
p=json.loads(sys.stdin.read() or '{}')
DATA='/opt/data'
ROOT=DATA+'/profiles'
SEAT_RE=re.compile(r'^[a-z][a-z0-9_-]{1,62}$')
SUBDIRS=['memories','sessions','skills','skins','logs','plans','workspace','cron','home']
MARKERS=('config.yaml','.env','SOUL.md','profile.yaml','auth.json','state.db')
ENV_HEADER="# Per-profile secrets for this Hermes profile.\n# API keys and tokens set here override the shell environment.\n# Behavioral settings belong in config.yaml, not here.\n"
MAX_ENTRIES=5000
provision=p.get('mode')=='provision'
uid=os.getuid()
def lst(path):
 try: return os.lstat(path)
 except FileNotFoundError: return None
def private(st): return st is not None and not (stat.S_IMODE(st.st_mode) & 0o077)
def tree(d):
 bad=0; links=0; n=0
 for root, dirs, files in os.walk(d, followlinks=False):
  for name in dirs+files:
   n+=1
   if n>MAX_ENTRIES: return bad, links, True
   st=lst(os.path.join(root,name))
   if st is None: continue
   if stat.S_ISLNK(st.st_mode): links+=1
   elif st.st_uid!=uid: bad+=1
 return bad, links, False
def model_summary(m):
 if isinstance(m,dict): return {'provider':str(m.get('provider') or ''),'default':str(m.get('default') or m.get('model') or ''),'api_mode':str(m.get('api_mode') or ''),'baseUrlSet':bool(m.get('base_url'))}
 if isinstance(m,str) and m: return {'provider':'','default':m,'api_mode':'','baseUrlSet':False}
 return None
def seat(s):
 sid=str(s.get('id') or '')
 r={'seatId':sid,'state':'invalid','reason':'','changed':[],'missingSubdirs':[],'identity':False,'writable':False,'envPresent':False,'envPrivate':False,'foreignOwned':0,'symlinks':0,'seatAuthFile':False,'model':None}
 if not SEAT_RE.match(sid): return r
 d=os.path.join(ROOT,sid)
 st=lst(d)
 if st is None:
  r['state']='not_seeded'; r['reason']='seat profile directory is missing'; return r
 if not stat.S_ISDIR(st.st_mode):
  r['state']='foreign'; r['reason']='seat profile path is not a regular directory'; return r
 marker=os.path.join(d,'WAYPOINT_SEAT.json'); mst=lst(marker); meta=None
 if mst is not None and stat.S_ISREG(mst.st_mode) and mst.st_size<=65536:
  try: meta=json.load(open(marker,encoding='utf-8'))
  except Exception: meta=None
 if not isinstance(meta,dict) or meta.get('seatId')!=sid:
  r['state']='foreign'; r['reason']='missing or mismatched Waypoint seat marker'; return r
 bad,links,truncated=tree(d)
 r['foreignOwned']=bad; r['symlinks']=links
 r['writable']=st.st_uid==uid and os.access(d,os.W_OK|os.X_OK) and bad==0 and not truncated
 r['seatAuthFile']=lst(os.path.join(d,'auth.json')) is not None
 if not r['writable']:
  r['state']='not_writable'; r['reason']='seat profile tree is not fully owned by and writable for the hermes user'; return r
 for sub in SUBDIRS:
  sp=os.path.join(d,sub); sst=lst(sp)
  if sst is None:
   if provision: os.mkdir(sp,0o700); r['changed'].append(sub+'/')
   else: r['missingSubdirs'].append(sub)
  elif not stat.S_ISDIR(sst.st_mode):
   r['state']='foreign'; r['reason']=sub+' is not a regular directory'; return r
 if provision and not private(st): os.chmod(d,0o700); r['changed'].append('mode:profile'); st=lst(d)
 env=os.path.join(d,'.env'); est=lst(env)
 if est is not None and not stat.S_ISREG(est.st_mode):
  r['state']='foreign'; r['reason']='.env is not a regular file'; return r
 if est is None and provision:
  fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
  with os.fdopen(fd,'w',encoding='utf-8') as f: f.write(ENV_HEADER)
  r['changed'].append('.env'); est=lst(env)
 elif est is not None and provision and not private(est):
  os.chmod(env,0o600); r['changed'].append('mode:.env'); est=lst(env)
 r['envPresent']=est is not None; r['envPrivate']=private(est)
 cfg=os.path.join(d,'config.yaml'); cst=lst(cfg)
 if cst is not None and not stat.S_ISREG(cst.st_mode):
  r['state']='foreign'; r['reason']='config.yaml is not a regular file'; return r
 want=s.get('model') if provision else None
 current={}
 if cst is not None or want:
  from hermes_cli.config import read_user_config_raw, atomic_config_write
  current=read_user_config_raw(Path(cfg)) if cst is not None else {}
  m=current.get('model')
  if want:
   new=dict(m) if isinstance(m,dict) else {}
   new['provider']=want['provider']; new['default']=want['default']
   new.pop('model',None)
   for k in ('api_mode','base_url'):
    if want.get(k): new[k]=want[k]
    else: new.pop(k,None)
   if new!=m:
    current=dict(current); current['model']=new
    atomic_config_write(Path(cfg),current)
    r['changed'].append('config.yaml:model')
   cst=lst(cfg)
   if cst is not None and not private(cst): os.chmod(cfg,0o600); r['changed'].append('mode:config.yaml')
 r['model']=model_summary(current.get('model'))
 r['identity']=any(lst(os.path.join(d,m)) is not None for m in MARKERS)
 r['state']='ready' if r['identity'] and r['envPrivate'] and not r['missingSubdirs'] else 'needs_provision'
 return r
out={'rootOk':False,'podRootAuthFile':lst(os.path.join(DATA,'auth.json')) is not None,'seats':[]}
rst=lst(ROOT)
out['rootOk']=rst is not None and stat.S_ISDIR(rst.st_mode)
for s in (p.get('seats') or []):
 if not out['rootOk']: break
 try: out['seats'].append(seat(s))
 except Exception as e: out['seats'].append({'seatId':str(s.get('id') or ''),'state':'error','reason':type(e).__name__})
sys.stdout.write('\n'+json.dumps(out)+'\n')
`;
