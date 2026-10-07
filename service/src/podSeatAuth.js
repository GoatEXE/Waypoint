import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { badRequest, conflict, lifecycleError, notFound } from './errors.js';

const OAUTH_PROVIDERS = new Set(['anthropic', 'openai-codex']);
const PROVIDER_ALIASES = { openai: 'openai-api' };
const API_KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', 'openai-api': 'OPENAI_API_KEY', openai: 'OPENAI_API_KEY' };
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const LOGIN_OUTPUT_LIMIT = 4096;
const LOGIN_ID_RE = /^seat_login_[0-9a-f-]{36}$/;
const MAX_CODE_CHARS = 2048;
const MAX_API_KEY_CHARS = 4096;
const SCRIPT_OUTPUT_LIMIT = 16 * 1024;
const KILL_OUTPUT_LIMIT = 8 * 1024;
const DEFAULT_AUTH_TIMEOUT_MS = 20_000;
const KILL_TIMEOUT_MS = 10_000;
const TERMINAL_TTL_MS = 5 * 60_000;

export class PodSeatAuth {
  constructor({ config, docker, podSeats, runner = undefined, spawner = defaultSpawner, logger = undefined }) {
    this.config = config;
    this.docker = docker;
    this.podSeats = podSeats;
    this.runner = runner || ((command, args, options) => this.podSeats.runner(command, args, options));
    this.spawner = spawner;
    this.logger = logger;
    this.logins = new Map();
  }

  async startLogin(instance, seatId, provider, input = {}) {
    provider = normalizeOAuthProvider(provider);
    const flow = String(input?.flow || (provider === 'openai-codex' ? 'device' : 'authorization-code'));
    if (provider === 'openai-codex' && flow !== 'device') throw badRequest('Codex seat login supports device-code OAuth only');
    if (provider === 'anthropic' && flow !== 'authorization-code') throw badRequest('Anthropic seat login uses authorization-code OAuth');
    this.evictTerminalLogins();
    const prepared = await this.prepareSeat(instance, seatId, { provider });
    const loginKey = loginKeyFor(prepared.target.podId, prepared.seat.id, provider);
    const existing = [...this.logins.values()].find((login) => login.loginKey === loginKey && ['pending', 'cancelling'].includes(login.state));
    if (existing) return publicLogin(existing);

    const id = `seat_login_${randomUUID()}`;
    const timeoutSeconds = this.config.hermes?.loginTimeoutSeconds || 600;
    const wrapperPayload = { loginId: id, seatId: prepared.seat.id, provider, timeoutSeconds };
    const args = ['exec', '-i', '--user', 'hermes', prepared.target.containerName, 'python3', '-c', LOGIN_WRAPPER_SCRIPT, JSON.stringify(wrapperPayload)];
    const child = this.spawner('docker', args, { timeoutMs: (timeoutSeconds * 1000) + 5000 });
    const login = {
      id,
      loginKey,
      podId: prepared.target.podId,
      seatId: prepared.seat.id,
      provider,
      flow,
      state: 'pending',
      authUrl: '',
      userCode: '',
      requiresCode: provider === 'anthropic',
      outputBuffer: '',
      containerName: prepared.target.containerName,
      containerPid: 0,
      containerPgid: 0,
      cancelReason: '',
      wrapperCompleted: false,
      wrapperExitCode: null,
      providerRejectedMessage: '',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      message: 'Waiting for provider authorization.',
      child,
    };
    this.logins.set(id, login);
    const onData = (chunk) => this.consumeLoginOutput(login, chunk);
    child.stdout?.on?.('data', onData);
    child.stderr?.on?.('data', onData);
    child.stdin?.on?.('error', () => {});
    child.on?.('error', () => this.handleLoginDisconnect(login, 'Docker exec client error before Waypoint could confirm the in-container Hermes auth outcome.'));
    child.on?.('close', (code) => this.handleLoginClose(login, code));
    const timeoutMs = Math.max(1, (timeoutSeconds * 1000) + 5000);
    login.timer = setTimeout(() => {
      if (!['pending', 'cancelling'].includes(login.state)) return;
      void this.beginCancellation(login, 'timeout');
    }, timeoutMs);
    login.timer.unref?.();
    this.logger?.info?.('pod_seat_login_started', { podId: login.podId, seatId: login.seatId, provider: login.provider, flow: login.flow });
    return publicLogin(login);
  }

  getLogin(podId, seatId, provider, id) {
    provider = normalizeOAuthProvider(provider);
    return publicLogin(this.lookupLogin(podId, seatId, provider, id));
  }

  submitLoginCode(podId, seatId, provider, id, input = {}) {
    provider = normalizeOAuthProvider(provider);
    const login = this.lookupLogin(podId, seatId, provider, id);
    if (login.state !== 'pending') throw conflict('login is not pending', { state: login.state });
    if (!login.requiresCode) throw badRequest('this login flow does not accept an authorization code through Waypoint');
    const code = String(input?.code || '').trim();
    if (code.length < 4 || code.length > MAX_CODE_CHARS || /[\x00-\x1f\x7f]/.test(code)) throw badRequest('authorization code has an invalid shape');
    login.child?.stdin?.write?.(`${code}\n`);
    login.updatedAt = new Date().toISOString();
    login.message = 'Authorization code submitted to Hermes; waiting for provider confirmation.';
    return publicLogin(login);
  }

  cancelLogin(podId, seatId, provider, id) {
    provider = normalizeOAuthProvider(provider);
    const login = this.lookupLogin(podId, seatId, provider, id);
    if (login.state === 'pending') void this.beginCancellation(login, 'user');
    else if (login.state === 'cancelling' && login.containerPid && login.containerPgid && !login.cancelPromise) void this.beginCancellation(login, login.cancelReason || 'user');
    return publicLogin(login);
  }

  async beginCancellation(login, reason) {
    if (isTerminal(login)) return publicLogin(login);
    if (login.cancelPromise) return login.cancelPromise;
    login.state = 'cancelling';
    login.cancelReason = reason;
    login.message = reason === 'timeout'
      ? 'Login timed out. Waypoint is terminating the in-container Hermes auth process before reporting a terminal outcome.'
      : 'Cancellation requested. Waypoint is terminating the in-container Hermes auth process.';
    login.updatedAt = new Date().toISOString();
    login.cancelPromise = this.terminateContainerLogin(login).then((terminated) => {
      delete login.cancelPromise;
      if (terminated && !isTerminal(login)) {
        const state = reason === 'user' ? 'cancelled' : 'failed';
        const message = reason === 'timeout'
          ? 'Provider authorization timed out and the in-container Hermes auth process was terminated. Start a fresh login and try again.'
          : reason === 'disconnect'
            ? 'Docker exec disconnected before completion was confirmed; the in-container Hermes auth process was terminated. Start a fresh login and try again.'
            : 'Cancellation confirmed inside the pod. Refresh seat provider status before starting work; Waypoint did not inspect or expose any credential material.';
        this.finishLogin(login, state, message);
      } else if (!isTerminal(login)) {
        login.state = 'cancelling';
        login.message = 'Cancellation is not yet confirmed inside the pod. Do not start another login for this seat/provider until this login reaches a terminal state or the pod is restarted.';
        login.updatedAt = new Date().toISOString();
      }
      return publicLogin(login);
    }).catch((error) => {
      delete login.cancelPromise;
      if (!isTerminal(login)) {
        login.state = 'cancelling';
        login.message = 'Cancellation is not yet confirmed inside the pod. Do not start another login for this seat/provider until this login reaches a terminal state or the pod is restarted.';
        login.updatedAt = new Date().toISOString();
      }
      this.logger?.warn?.('pod_seat_login_cancel_unconfirmed', { podId: login.podId, seatId: login.seatId, provider: login.provider, message: safeLogMessage(error?.message || error) });
      return publicLogin(login);
    });
    return login.cancelPromise;
  }

  async terminateContainerLogin(login) {
    if (!login.containerPid || !login.containerPgid) return false;
    const payload = JSON.stringify({ loginId: login.id, seatId: login.seatId, provider: login.provider, pid: login.containerPid, pgid: login.containerPgid });
    const result = await this.runner('docker', ['exec', '-i', '--user', 'hermes', login.containerName, 'python3', '-c', KILL_LOGIN_SCRIPT], { input: payload, timeoutMs: KILL_TIMEOUT_MS, outputLimitBytes: KILL_OUTPUT_LIMIT });
    if (result.timedOut || result.code !== 0) return false;
    const parsed = parseJsonLine(result.stdout, 'seat login cancellation returned an unexpected shape');
    return parsed.ok === true && parsed.terminated === true;
  }

  handleLoginClose(login, code) {
    if (isTerminal(login)) return;
    if (login.wrapperCompleted) {
      this.completeLoginFromWrapper(login, login.wrapperExitCode ?? code ?? 1);
      return;
    }
    this.handleLoginDisconnect(login, `Docker exec closed before Waypoint saw the in-container completion marker (code ${Number.isInteger(code) ? code : 'unknown'}).`);
  }

  handleLoginDisconnect(login, message) {
    if (isTerminal(login)) return;
    if (login.containerPid && login.containerPgid) {
      void this.beginCancellation(login, 'disconnect');
      return;
    }
    login.state = 'cancelling';
    login.cancelReason ||= 'disconnect';
    login.message = `${message} Cancellation cannot yet be confirmed inside the pod; do not start another login for this seat/provider until this login reaches a terminal state or the pod is restarted.`;
    login.updatedAt = new Date().toISOString();
  }

  completeLoginFromWrapper(login, code) {
    if (isTerminal(login)) return;
    const exitCode = Number.isInteger(code) ? code : 1;
    if (login.state === 'cancelling' && login.cancelReason) {
      if (exitCode === 0) this.finishLogin(login, 'authorized', 'Provider authorization completed for this seat before cancellation was confirmed.');
      else {
        const state = login.cancelReason === 'user' ? 'cancelled' : 'failed';
        const message = login.cancelReason === 'timeout'
          ? 'Provider authorization timed out and Hermes exited without authorizing. Start a fresh login and try again.'
          : login.cancelReason === 'disconnect'
            ? 'Docker exec disconnected, but the in-container Hermes auth process exited without authorizing. Start a fresh login and try again.'
            : 'Cancellation confirmed by in-container Hermes auth exit. Refresh seat provider status before starting work.';
        this.finishLogin(login, state, message);
      }
      return;
    }
    this.finishLogin(login, exitCode === 0 ? 'authorized' : 'failed', exitCode === 0 ? 'Provider authorization completed for this seat.' : (login.providerRejectedMessage || 'Provider authorization did not complete. Start a fresh login and try again.'));
  }

  async saveApiKey(instance, seatId, provider, input = {}) {
    const canonical = normalizeApiKeyProvider(provider);
    const envName = API_KEY_ENV[canonical] || API_KEY_ENV[provider];
    if (!envName) throw badRequest('API-key fallback is supported for Anthropic and OpenAI API billing, not Codex subscription OAuth', { provider: String(provider || '').slice(0, 64) });
    const apiKey = String(input?.apiKey || '');
    if (apiKey.length < 8 || apiKey.length > MAX_API_KEY_CHARS || /[\x00-\x1f\x7f]/.test(apiKey)) throw badRequest('apiKey has an invalid shape');
    const prepared = await this.prepareSeat(instance, seatId, { provider: canonical });
    const payload = JSON.stringify({ seatId: prepared.seat.id, key: envName, value: apiKey });
    const result = await this.runner('docker', ['exec', '-i', '--user', 'hermes', prepared.target.containerName, 'python3', '-c', WRITE_SEAT_ENV_KEY_SCRIPT], { input: payload, timeoutMs: DEFAULT_AUTH_TIMEOUT_MS, outputLimitBytes: SCRIPT_OUTPUT_LIMIT });
    if (result.timedOut) throw lifecycleError('seat API key write timed out', { podId: prepared.target.podId, seatId: prepared.seat.id });
    if (result.code !== 0) throw lifecycleError('seat API key could not be saved', { podId: prepared.target.podId, seatId: prepared.seat.id, code: result.code });
    const parsed = parseJsonLine(result.stdout, 'seat API key writer returned an unexpected shape');
    if (parsed.ok !== true) throw lifecycleError('seat API key could not be saved', { podId: prepared.target.podId, seatId: prepared.seat.id });
    this.logger?.info?.('pod_seat_api_key_saved', { podId: prepared.target.podId, seatId: prepared.seat.id, provider: canonical });
    return { podId: prepared.target.podId, seatId: prepared.seat.id, provider: canonical, configured: true, credentialPresent: true, authMode: 'api-key', message: 'API key saved to the seat profile .env. Readiness is verified by Hermes when a provider request is made.' };
  }

  async prepareSeat(instance, seatId, { provider }) {
    if (this.config.dryRun) throw conflict('seat provider connection requires DRY_RUN=false');
    const target = this.podSeats.resolveTarget(instance, { seatIds: [seatId], providers: [provider] });
    await this.podSeats.verifyPod(target);
    const profiles = await this.podSeats.execSeatScript(target, 'inspect');
    const seat = target.seats[0];
    const profile = profiles.get(seat.id);
    if (!profile || profile.state !== 'ready' || profile.identity !== true || profile.envPrivate !== true || profile.writable !== true) {
      throw conflict('seat profile is not ready; provision the seat before connecting a provider', { seatId: seat.id, state: profile?.state || 'missing' });
    }
    return { target, seat, profile };
  }

  lookupLogin(podId, seatId, provider, id) {
    const value = String(id || '');
    if (!LOGIN_ID_RE.test(value)) throw notFound('login not found');
    const login = this.logins.get(value);
    if (!login || login.podId !== String(podId || '') || login.seatId !== String(seatId || '') || login.provider !== provider) throw notFound('login not found');
    if (isTerminal(login) && login.terminalAt && Date.now() - login.terminalAt > TERMINAL_TTL_MS) {
      this.logins.delete(login.id);
      throw notFound('login not found');
    }
    return login;
  }

  consumeLoginOutput(login, chunk) {
    const text = stripAnsi(String(chunk || ''));
    login.outputBuffer = `${login.outputBuffer || ''}${text}`.slice(-LOGIN_OUTPUT_LIMIT);
    this.consumeLoginMarkers(login, login.outputBuffer);
    if (isTerminal(login)) return;
    const view = login.outputBuffer;
    const url = extractAllowedAuthUrl(view);
    if (url) login.authUrl = url;
    const code = view.match(/Enter this code:\s*([A-Z0-9-]{4,32})/is)?.[1] || view.match(/^\s*([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\s*$/m)?.[1];
    if (code) login.userCode = code;
    if (/Authorization code:/i.test(view)) login.requiresCode = true;
    const rejection = loginRejectionMessage(view);
    if (rejection && !login.providerRejectedMessage) {
      login.providerRejectedMessage = rejection;
      if (login.state === 'pending') login.message = `${rejection} Waiting for Hermes to exit before reporting a terminal outcome.`;
    }
    if (!login.providerRejectedMessage && /Waiting for sign-in|Waiting for provider|Authorization code:/i.test(view)) {
      login.message = login.requiresCode ? 'Open the provider URL, authorize Hermes, then paste the returned authorization code.' : 'Open the provider URL and enter the displayed device code.';
    }
    login.updatedAt = new Date().toISOString();
  }

  consumeLoginMarkers(login, view) {
    for (const line of String(view || '').split(/\r?\n/)) {
      if (!line.includes('waypointLogin')) continue;
      try {
        const parsed = JSON.parse(line.trim());
        const marker = parsed.waypointLogin;
        if (!login.containerPid && marker?.id === login.id && marker?.seatId === login.seatId && marker?.provider === login.provider && Number.isInteger(marker.pid) && Number.isInteger(marker.pgid)) {
          login.containerPid = marker.pid;
          login.containerPgid = marker.pgid;
          if (login.state === 'cancelling' && login.cancelReason && !login.cancelPromise) void this.beginCancellation(login, login.cancelReason);
        }
        const complete = parsed.waypointLoginComplete;
        if (complete?.id === login.id && complete?.seatId === login.seatId && complete?.provider === login.provider && Number.isInteger(complete.code)) {
          login.wrapperCompleted = true;
          login.wrapperExitCode = complete.code;
          this.completeLoginFromWrapper(login, complete.code);
        }
      } catch {   }
    }
  }

  finishLogin(login, state, message) {
    login.state = state;
    login.message = message;
    if (isTerminal(login)) {
      login.authUrl = '';
      login.userCode = '';
      login.terminalAt = Date.now();
      clearTimeout(login.timer);
      delete login.child;
      delete login.timer;
      delete login.cancelPromise;
    }
    login.updatedAt = new Date().toISOString();
  }

  evictTerminalLogins() {
    const now = Date.now();
    for (const [id, login] of this.logins.entries()) if (isTerminal(login) && login.terminalAt && now - login.terminalAt > TERMINAL_TTL_MS) this.logins.delete(id);
  }
}

function normalizeOAuthProvider(provider) {
  const canonical = String(provider || '').trim();
  if (!OAUTH_PROVIDERS.has(canonical)) throw badRequest('seat OAuth is supported for Anthropic and OpenAI Codex only', { provider: canonical.slice(0, 64) });
  return canonical;
}
function normalizeApiKeyProvider(provider) {
  const value = String(provider || '').trim();
  const canonical = PROVIDER_ALIASES[value] || value;
  if (!['anthropic', 'openai-api'].includes(canonical)) throw badRequest('API-key fallback is supported for Anthropic and OpenAI API billing, not Codex subscription OAuth', { provider: value.slice(0, 64) });
  return canonical;
}
function loginKeyFor(podId, seatId, provider) { return `${podId}\n${seatId}\n${provider}`; }
function isTerminal(login) { return ['authorized', 'failed', 'cancelled'].includes(login?.state); }
function publicLogin(login) {
  return { id: login.id, podId: login.podId, seatId: login.seatId, provider: login.provider, flow: login.flow, state: login.state, authUrl: login.authUrl, userCode: login.userCode, requiresCode: login.requiresCode, startedAt: login.startedAt, updatedAt: login.updatedAt, message: login.message };
}
function stripAnsi(text) { return text.replace(ANSI_RE, ''); }
function extractAllowedAuthUrl(text) {
  const matches = String(text || '').match(/https:\/\/[^\s)]+/gi) || [];
  return matches.map((url) => url.replace(/[.,;:!?]+$/, '')).find(isAllowedAuthUrl) || '';
}
function isAllowedAuthUrl(url) {
  try {
    const host = new URL(url).host;
    return ['auth.openai.com', 'claude.ai', 'console.anthropic.com'].includes(host);
  } catch { return false; }
}
function loginRejectionMessage(text) {
  const view = String(text || '');
  const rejected = /\binvalid[_ -]?grant\b/i.test(view)
    || /\baccess[_ -]?denied\b/i.test(view)
    || /\bauthori[sz]ation (?:was )?denied\b/i.test(view)
    || /\buser denied\b/i.test(view)
    || /\bprovider (?:rejected|denied)\b/i.test(view)
    || /\bexpired[_ -]?token\b/i.test(view)
    || /\b(?:authorization|authorisation|oauth|login|sign-?in|code|token).{0,40}\bexpired\b/i.test(view)
    || /\bauthori[sz]ation[_ -]?cancel(?:led|ed)\b/i.test(view)
    || /\blogin (?:was )?cancel(?:led|ed)\b/i.test(view)
    || /\bsign-?in (?:was )?cancel(?:led|ed)\b/i.test(view);
  return rejected ? 'Provider rejected or expired the authorization. Start a fresh login and try again.' : '';
}
function parseJsonLine(stdout, message) {
  const line = String(stdout || '').trim().split(/\r?\n/).reverse().find((text) => text.trim().startsWith('{'));
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {   }
  throw lifecycleError(message);
}
function safeLogMessage(message = '') {
  return String(message).replace(/[A-Za-z0-9_=-]{24,}/g, '[redacted]').slice(0, 160);
}
function defaultSpawner(command, args) {
  return spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

export const LOGIN_WRAPPER_SCRIPT = String.raw`
import json, os, re, signal, subprocess, sys, threading
p=json.loads(sys.argv[1] if len(sys.argv)>1 else '{}')
login_id=str(p.get('loginId') or '')
seat=str(p.get('seatId') or '')
provider=str(p.get('provider') or '')
timeout=str(p.get('timeoutSeconds') or '600')
if not re.match(r'^seat_login_[0-9a-f-]{36}$',login_id) or not re.match(r'^[a-z][a-z0-9_-]{1,62}$',seat) or provider not in {'anthropic','openai-codex'}:
 raise SystemExit(2)
profile=os.path.join('/opt/data/profiles',seat)
marker_dir=os.path.join(profile,'waypoint')
os.makedirs(marker_dir,mode=0o700,exist_ok=True)
cmd=['hermes','-p',seat,'auth','add',provider,'--type','oauth','--no-browser','--timeout',timeout]
proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,preexec_fn=os.setsid)
pgid=os.getpgid(proc.pid)
term_lock=threading.Lock()
def terminate_child():
 with term_lock:
  if proc.poll() is not None: return
  for sig in (signal.SIGTERM, signal.SIGKILL):
   if proc.poll() is not None: return
   try: os.killpg(pgid,sig)
   except ProcessLookupError: return
   except Exception:
    try: proc.kill()
    except Exception: pass
   try: proc.wait(timeout=2 if sig==signal.SIGTERM else 1)
   except subprocess.TimeoutExpired: pass
def emit(obj,prefix_newline=False):
 try:
  if prefix_newline: sys.stdout.write('\n')
  print(json.dumps(obj),flush=True)
  return True
 except (BrokenPipeError,OSError):
  return False
marker={'id':login_id,'seatId':seat,'provider':provider,'pid':proc.pid,'pgid':pgid}
marker_path=os.path.join(marker_dir,'auth-login-'+login_id+'.json')
fd=os.open(marker_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w',encoding='utf-8') as f:
 json.dump(marker,f)
 f.write('\n')
if not emit({'waypointLogin':marker}):
 terminate_child()
def pump_fd(src_fd,dst_fd,close_dst=False,kill_on_eof=False):
 try:
  while True:
   data=os.read(src_fd,4096)
   if not data:
    if kill_on_eof and proc.poll() is None: terminate_child()
    break
   view=memoryview(data)
   while view:
    try:
     written=os.write(dst_fd,view)
    except OSError:
     terminate_child(); return
    view=view[written:]
 except OSError:
  if kill_on_eof and proc.poll() is None: terminate_child()
 finally:
  if close_dst:
   try: os.close(dst_fd)
   except OSError: pass
threads=[threading.Thread(target=pump_fd,args=(proc.stdout.fileno(),sys.stdout.fileno()),daemon=True),threading.Thread(target=pump_fd,args=(proc.stderr.fileno(),sys.stderr.fileno()),daemon=True),threading.Thread(target=pump_fd,args=(sys.stdin.fileno(),proc.stdin.fileno(),True,True),daemon=True)]
for t in threads: t.start()
code=proc.wait()
emit({'waypointLoginComplete':{'id':login_id,'seatId':seat,'provider':provider,'code':code}},prefix_newline=True)
try: os.unlink(marker_path)
except FileNotFoundError: pass
except Exception: pass
raise SystemExit(code)
`;

export const KILL_LOGIN_SCRIPT = String.raw`
import json, os, re, signal, stat, sys, time
p=json.loads(sys.stdin.read() or '{}')
login_id=str(p.get('loginId') or '')
seat=str(p.get('seatId') or '')
provider=str(p.get('provider') or '')
pid=int(p.get('pid') or 0); pgid=int(p.get('pgid') or 0)
if not re.match(r'^seat_login_[0-9a-f-]{36}$',login_id) or not re.match(r'^[a-z][a-z0-9_-]{1,62}$',seat) or provider not in {'anthropic','openai-codex'} or pid<=1 or pgid<=1:
 raise SystemExit(2)
profile=os.path.join('/opt/data/profiles',seat)
marker_path=os.path.join(profile,'waypoint','auth-login-'+login_id+'.json')
def alive(x):
 try: os.kill(x,0)
 except ProcessLookupError: return False
 except PermissionError: return True
 try:
  stat_line=open('/proc/%d/stat'%x,encoding='utf-8',errors='ignore').read()
  end=stat_line.rfind(')')
  if end!=-1 and stat_line[end+2:end+3]=='Z': return False
 except FileNotFoundError:
  return False
 except Exception:
  pass
 return True
try:
 st=os.lstat(marker_path)
 if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode): raise RuntimeError('bad marker')
 marker=json.load(open(marker_path,encoding='utf-8'))
except Exception:
 marker={}
if marker.get('id')!=login_id or marker.get('seatId')!=seat or marker.get('provider')!=provider or marker.get('pid')!=pid or marker.get('pgid')!=pgid:
 raise SystemExit(3)
if alive(pid):
 try:
  status=open('/proc/%d/status'%pid,encoding='utf-8',errors='ignore').read()
  uid_line=next((line for line in status.splitlines() if line.startswith('Uid:')), '')
  if uid_line and int(uid_line.split()[1]) != os.getuid(): raise SystemExit(4)
  cmdline=open('/proc/%d/cmdline'%pid,'rb').read().replace(b'\x00',b' ')
  if b'hermes' not in cmdline or b'auth' not in cmdline: raise SystemExit(5)
  if os.getpgid(pid)!=pgid: raise SystemExit(6)
 except FileNotFoundError:
  pass
for sig in (signal.SIGTERM, signal.SIGKILL):
 if alive(pid):
  try: os.killpg(pgid,sig)
  except ProcessLookupError: pass
  except Exception: os.kill(pid,sig)
 deadline=time.time()+(3.0 if sig==signal.SIGTERM else 1.0)
 while time.time()<deadline and alive(pid): time.sleep(0.05)
try: os.unlink(marker_path)
except Exception: pass
sys.stdout.write(json.dumps({'ok':True,'terminated':not alive(pid)})+'\n')
`;

export const WRITE_SEAT_ENV_KEY_SCRIPT = String.raw`
import json, os, re, stat, sys
p=json.loads(sys.stdin.read() or '{}')
seat=str(p.get('seatId') or '')
key=str(p.get('key') or '')
value=str(p.get('value') or '')
SEAT_RE=re.compile(r'^[a-z][a-z0-9_-]{1,62}$')
KEYS={'ANTHROPIC_API_KEY','OPENAI_API_KEY'}
if not SEAT_RE.match(seat) or key not in KEYS or not value or any(ord(c)<32 or ord(c)==127 for c in value):
 raise SystemExit(2)
root='/opt/data/profiles'
profile=os.path.join(root,seat)
def lst(x):
 try: return os.lstat(x)
 except FileNotFoundError: return None
pst=lst(profile)
if pst is None or not stat.S_ISDIR(pst.st_mode) or pst.st_uid!=os.getuid():
 raise SystemExit(3)
marker=os.path.join(profile,'WAYPOINT_SEAT.json')
try:
 meta=json.load(open(marker,encoding='utf-8'))
except Exception:
 meta=None
if not isinstance(meta,dict) or meta.get('seatId')!=seat:
 raise SystemExit(4)
env_path=os.path.join(profile,'.env')
est=lst(env_path)
if est is None or not stat.S_ISREG(est.st_mode) or stat.S_ISLNK(est.st_mode) or (stat.S_IMODE(est.st_mode) & 0o077) != 0:
 raise SystemExit(5)
os.environ['HERMES_HOME']=profile
os.environ.pop('HERMES_PROFILE',None)
from hermes_cli.credential_lifecycle import save_provider_env_credential
result=save_provider_env_credential(key,value)
if result.get('ok') is not True:
 raise SystemExit(6)
os.chmod(env_path,0o600)
sys.stdout.write('{"ok":true}\n')
`;
