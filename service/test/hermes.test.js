import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HermesRuntime } from '../src/hermes.js';
import { loadConfig } from '../src/config.js';

function config() { return loadConfig({ HERMES_LOGIN_TIMEOUT_SECONDS: '5' }, '/tmp'); }
function runnerFactory(calls, state = {}) {
  return async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (args[0] === 'inspect') {
      if (state.missing) return { code: 1, stdout: '', stderr: 'No such object: waypoint-hermes-ceo' };
      return { code: 0, stdout: '{"owned":"true","id":"c1","state":"running","running":true}\n', stderr: '' };
    }
    if (args[0] === 'volume') return { code: 0, stdout: 'waypoint-hermes-ceo-home\n', stderr: '' };
    if (args[0] === 'run' || args[0] === 'start' || args[0] === 'stop') return { code: 0, stdout: 'ok\n', stderr: '' };
    if (args[0] === 'exec' && args.includes('python3')) {
      const script = String(args.at(-1));
      if (script.includes('provider_model_ids')) return { code: 0, stdout: JSON.stringify({ source: 'native-hermes-provider_model_ids', providers: [
        { id: 'openai-codex', label: 'OpenAI Codex', nativeProvider: 'openai-codex', default: 'gpt-6-sol', api_mode: 'codex_responses', source: 'native-hermes', models: ['gpt-6-sol', 'gpt-5.3-codex-spark'] },
        { id: 'anthropic', label: 'Anthropic Claude', nativeProvider: 'anthropic', default: 'claude-fable-5.1', api_mode: 'anthropic_messages', source: 'native-hermes', models: ['claude-fable-5.1'] },
        { id: 'openai-api', label: 'OpenAI API', nativeProvider: 'openai-api', default: 'gpt-6-sol', api_mode: 'codex_responses', source: 'native-hermes', models: ['gpt-6-sol'] },
      ] }) + '\n', stderr: '' };
      if (script.includes("'model':")) return { code: 0, stdout: '{}', stderr: '' };
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
    return { code: 0, stdout: 'ok', stderr: '' };
  };
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdinText = '';
    this.stdin = new Writable({ write: (chunk, _encoding, cb) => { this.stdinText += String(chunk); cb(); } });
    this.killedSignal = '';
  }
  kill(signal) { this.killedSignal = signal; this.emit('close', 143, signal); }
}

test('Hermes start uses pinned image, dedicated volume, and Waypoint labels only', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, runnerFactory(calls, { missing: true }));
  await hermes.start();
  const run = calls.find((c) => c.args[0] === 'run');
  assert.ok(run.args.includes('nousresearch/hermes-agent@sha256:d4da4a40cd7a28aba983775d9fd31d94cbf153eeb0cb9e844d6d0f612b7c24db'));
  assert.ok(run.args.includes('type=volume,source=waypoint-hermes-ceo-home,target=/opt/data'));
  assert.ok(run.args.includes('--label'));
  assert.equal(run.args.includes('~/.codex'), false);
  assert.deepEqual(run.args.slice(-2), ['gateway', 'run']);
});

test('startup reconciliation refuses unowned CEO names before creating volumes or containers', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (args[0] === 'inspect') return { code: 0, stdout: '{"owned":"","id":"c1","state":"exited","running":false}\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  });
  await assert.rejects(() => hermes.reconcileStartup(), /ownership label/);
  assert.equal(calls.some((c) => c.args[0] === 'volume' || c.args[0] === 'run' || c.args[0] === 'start'), false);
});

test('CEO home preparation sets unattended approvals and human-only review, preserving other config', async () => {
  const calls = [];
  const settings = { 'approvals.single_query_mode': 'deny', 'kanban.review_dispatch': 'True', 'model.default': 'claude-opus-5-5' };
  const hermes = new HermesRuntime(config(), undefined, async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (args[0] === 'inspect') return { code: 0, stdout: '{"owned":"true","id":"c1","state":"running","running":true}\n', stderr: '' };
    if (args[0] === 'exec' && args.includes('python3')) return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
    if (args[0] === 'exec' && args.includes('config') && args.includes('get')) return { code: 0, stdout: `${settings[args.at(-1)]}\n`, stderr: '' };
    if (args[0] === 'exec' && args.includes('config') && args.includes('set')) {
      settings[args.at(-2)] = args.at(-1);
      return { code: 0, stdout: 'Saved\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });
  await hermes.syncRunning();
  assert.deepEqual(settings, { 'approvals.single_query_mode': 'approve', 'kanban.review_dispatch': 'false', 'model.default': 'claude-opus-5-5' });
  await hermes.syncRunning();
  assert.equal(calls.filter((c) => c.args.includes('config') && c.args.includes('set')).length, 2, 'settings already in place are left alone');
});

test('model settings and API-key save return sanitized flags and survive runtime object restart', async () => {
  const calls = [];
  const first = new HermesRuntime(config(), undefined, runnerFactory(calls));
  const saved = await first.saveModel({ provider: 'openai-codex', default: 'gpt-5-codex', api_mode: 'codex_responses' });
  assert.equal(saved.saved, true);
  const key = await first.saveApiKey('anthropic', { apiKey: 'sk-ant-secret-value-1234567890' });
  assert.equal(key.provider, 'anthropic');
  assert.equal(key.configured, true);
  assert.equal(key.credentialPresent, true);
  assert.equal(key.authenticated, false);
  assert.equal(JSON.stringify(key).includes('sk-ant'), false);
  const writeCalls = calls.filter((c) => c.args[0] === 'exec');
  assert.ok(writeCalls.some((c) => String(c.input).includes('gpt-5-codex')));
  assert.ok(writeCalls.some((c) => String(c.input).includes('ANTHROPIC_API_KEY')));

  const second = new HermesRuntime(config(), undefined, runnerFactory([]));
  assert.equal(second.containerName, first.containerName);
  assert.equal(second.volumeName, first.volumeName);
});

test('model catalog is provider-scoped, native-shaped, and preserves custom model saves', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, runnerFactory(calls));
  const catalog = await hermes.modelCatalog('openai-codex', { refresh: true });
  assert.equal(catalog.providers.length, 1);
  assert.equal(catalog.providers[0].id, 'openai-codex');
  assert.equal(catalog.providers[0].default, 'gpt-6-sol');
  assert.equal(catalog.providers[0].api_mode, 'codex_responses');
  assert.deepEqual(catalog.providers[0].models.map((m) => m.id), ['gpt-6-sol', 'gpt-5.3-codex-spark']);
  assert.equal(JSON.stringify(catalog).includes('sk-'), false);
  const saved = await hermes.saveModel({ provider: 'openai-codex', default: 'custom-unlisted-model', api_mode: 'codex_responses' });
  assert.equal(saved.model.default, 'custom-unlisted-model');
});

test('Anthropic Opus 5.5 official provider id is exposed when native catalog is pinned behind and can be saved', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, runnerFactory(calls));
  const catalog = await hermes.modelCatalog('anthropic', { refresh: true });
  const model = catalog.providers[0].models.find((m) => m.id === 'claude-opus-5-5');
  assert.equal(catalog.providers[0].id, 'anthropic');
  assert.equal(model?.source, 'verified-provider-compatibility');
  assert.match(model?.note || '', /account availability is not guaranteed/i);
  const saved = await hermes.saveModel({ provider: 'anthropic', default: 'claude-opus-5-5', api_mode: 'anthropic_messages' });
  assert.equal(saved.model.default, 'claude-opus-5-5');
});

test('model catalog falls back without starting or mutating a stopped runtime', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, runnerFactory(calls, { missing: true }));
  const catalog = await hermes.modelCatalog('anthropic');
  assert.equal(catalog.diagnostics.available, false);
  assert.equal(catalog.providers[0].id, 'anthropic');
  assert.equal(catalog.providers[0].api_mode, 'anthropic_messages');
  assert.ok(catalog.providers[0].models.some((m) => m.id === 'claude-fable-5.1'));
  assert.equal(calls.some((c) => ['run', 'start', 'volume'].includes(c.args[0])), false);
});

test('model catalog explicit refresh deduplicates native reads and later cache hits avoid Docker', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, runnerFactory(calls));
  const [one, two] = await Promise.all([
    hermes.modelCatalog('', { refresh: true }),
    hermes.modelCatalog('', { refresh: true }),
  ]);
  assert.equal(one.providers.length, 3);
  assert.deepEqual(two.providers.map((p) => p.id), one.providers.map((p) => p.id));
  assert.equal(calls.filter((c) => c.args[0] === 'exec' && String(c.args.at(-1)).includes('provider_model_ids')).length, 1);
  calls.length = 0;
  const cached = await hermes.modelCatalog('openai-codex');
  assert.equal(cached.providers.length, 1);
  assert.equal(cached.providers[0].id, 'openai-codex');
  assert.equal(cached.diagnostics.source, 'native-hermes-cache');
  assert.equal(calls.length, 0);
});

test('fresh status batches logical native auth providers and cached status avoids CLI probes', async () => {
  const calls = [];
  let activeAuth = 0;
  let maxActiveAuth = 0;
  const hermes = new HermesRuntime(config(), undefined, async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (args[0] === 'inspect') return { code: 0, stdout: '{"owned":"true","id":"c1","state":"running","running":true}\n', stderr: '' };
    if (args[0] === 'exec' && args.includes('python3')) return { code: 0, stdout: '{}', stderr: '' };
    if (args[0] === 'exec' && args.includes('hermes') && args.includes('auth') && args.includes('status')) {
      activeAuth += 1;
      maxActiveAuth = Math.max(maxActiveAuth, activeAuth);
      await new Promise((resolve) => setTimeout(resolve, 25));
      activeAuth -= 1;
      return { code: 0, stdout: 'logged out', stderr: '' };
    }
    return { code: 0, stdout: 'ok', stderr: '' };
  });
  const fresh = await hermes.status({ nativeAuth: 'fresh' });
  const authCalls = calls.filter((c) => c.args[0] === 'exec' && c.args.includes('hermes') && c.args.includes('auth') && c.args.includes('status'));
  assert.deepEqual(authCalls.map((c) => c.args.at(-1)).sort(), ['anthropic', 'openai-api', 'openai-codex']);
  assert.equal(authCalls.length, 3);
  assert.ok(maxActiveAuth > 1);
  assert.equal(fresh.auth.openai.ready, false);
  calls.length = 0;
  await hermes.status();
  assert.equal(calls.some((c) => c.args[0] === 'exec' && c.args.includes('hermes') && c.args.includes('auth') && c.args.includes('status')), false);
});

test('malformed auth and model inputs cannot inject Docker or shell args', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, runnerFactory(calls));
  await assert.rejects(() => hermes.saveModel({ provider: 'openai-codex;docker rm x', default: 'ok' }), /unsupported provider/);
  await assert.rejects(() => hermes.saveModel({ provider: 'openai-codex', default: 'bad model; rm -rf /' }), /invalid shape/);
  await assert.rejects(() => hermes.saveApiKey('anthropic', { apiKey: 'short' }), /invalid shape/);
  await assert.rejects(() => hermes.saveApiKey('anthropic', { apiKey: 'sk-ant-secret-value\nOPENAI_API_KEY=injected' }), /invalid shape/);
  assert.equal(calls.some((c) => c.args?.some((a) => String(a).includes('rm -rf'))), false);
});

test('concurrent login starts resume pending flow and login output is sanitized to URL/code/status', async () => {
  const child = new FakeChild();
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, runnerFactory(calls), () => child);
  const login = await hermes.startLogin('openai-codex', { flow: 'device' });
  assert.equal(login.state, 'pending');
  const resumed = await hermes.startLogin('openai-codex', { flow: 'device' });
  assert.equal(resumed.id, login.id);
  assert.equal(resumed.state, 'pending');
  child.stdout.emit('data', 'Open this URL in your browser:\n https://auth.openai.com/codex/device\nEnter this code:\n GT8H-L67YI\nsecret sk-abc12345678901234567890');
  const seen = hermes.getLogin('openai-codex', login.id);
  assert.equal(seen.authUrl, 'https://auth.openai.com/codex/device');
  assert.equal(seen.userCode, 'GT8H-L67YI');
  assert.equal(JSON.stringify(seen).includes('sk-abc'), false);
  const cancelled = hermes.cancelLogin('openai-codex', login.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.match(cancelled.message, /Refresh provider status/);
});

test('Anthropic auth output does not treat routine cancel instructions as rejection', async () => {
  const child = new FakeChild();
  const hermes = new HermesRuntime(config(), undefined, runnerFactory([]), () => child);
  const login = await hermes.startLogin('anthropic', { flow: 'authorization-code' });
  child.stderr.emit('data', 'Open this URL to authorize:\nhttps://claude.ai/oauth/authorize?client_id=example\nPress Ctrl-C to cancel.\nAuthorization code:');
  const seen = hermes.getLogin('anthropic', login.id);
  assert.equal(seen.state, 'pending');
  assert.equal(seen.authUrl, 'https://claude.ai/oauth/authorize?client_id=example');
  assert.match(seen.message, /paste the returned authorization code/i);
});

test('Anthropic auth output marks real provider rejection terminal and clears stale prompt material', async () => {
  const child = new FakeChild();
  const hermes = new HermesRuntime(config(), undefined, runnerFactory([]), () => child);
  const login = await hermes.startLogin('anthropic', { flow: 'authorization-code' });
  child.stderr.emit('data', 'Open this URL to authorize:\nhttps://claude.ai/oauth/authorize?client_id=example\nAuthorization code:');
  child.stderr.emit('data', 'OAuth error: invalid_grant authorization expired');
  const seen = hermes.getLogin('anthropic', login.id);
  assert.equal(seen.state, 'failed');
  assert.equal(seen.authUrl, '');
  assert.equal(seen.userCode, '');
  assert.match(seen.message, /rejected or expired/i);
});

function readyConversationRunner(calls) {
  return async (_command, args, options = {}) => {
    calls.push({ args, input: options.input });
    if (args[0] === 'inspect') return { code: 0, stdout: '{"owned":"true","id":"c1","state":"running","running":true}\n', stderr: '' };
    if (args[0] === 'exec' && args.includes('python3')) {
      const script = String(args.at(-1));
      if (script.includes("'model':")) return { code: 0, stdout: JSON.stringify({ model: { configured: true, provider: 'openai-codex', default: 'gpt-6-sol', api_mode: 'codex_responses' }, auth: {} }), stderr: '' };
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
    if (args[0] === 'exec' && args.includes('hermes') && args.includes('auth') && args.includes('status')) return { code: 0, stdout: 'authenticated and ready', stderr: '' };
    return { code: 0, stdout: 'ok', stderr: '' };
  };
}

async function conversationHermes(children) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-ceo-convo-'));
  const cfg = loadConfig({ DATA_DIR: dir, HERMES_CEO_TURN_TIMEOUT_SECONDS: '5' }, process.cwd());
  const calls = [];
  const spawns = [];
  const hermes = new HermesRuntime(cfg, undefined, readyConversationRunner(calls), (_command, args) => {
    spawns.push(args);
    return children.shift();
  });
  return { hermes, calls, spawns, dir };
}

async function waitFor(condition, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('condition was not reached');
}

test('CEO conversation creates a named Hermes session, persists messages, and resumes by session id', async () => {
  const firstChild = new FakeChild();
  const secondChild = new FakeChild();
  const { hermes, spawns, dir } = await conversationHermes([firstChild, secondChild]);
  const first = hermes.sendCeoMessage({ message: 'Say one safe sentence.' });
  await waitFor(() => spawns.length === 1);
  assert.ok(spawns[0].includes('timeout'));
  assert.ok(spawns[0].includes('--kill-after=2s'));
  assert.ok(spawns[0].includes('hermes'));
  assert.ok(spawns[0].includes('--continue'));
  const firstConversationName = spawns[0][spawns[0].indexOf('--continue') + 1];
  assert.match(firstConversationName, /^waypoint-ceo-[A-Za-z0-9_.:-]+$/);
  assert.notEqual(firstConversationName, 'waypoint-ceo');
  assert.equal(spawns[0].includes('--resume'), false);
  assert.equal(firstChild.stdinText, 'Say one safe sentence.');
  const during = await hermes.ceoConversation();
  assert.deepEqual(during.messages.map((m) => [m.role, m.text, m.status]), [['user', 'Say one safe sentence.', 'sent']]);
  assert.equal(during.live.message, 'Say one safe sentence.');
  const restarted = new HermesRuntime(hermes.config, undefined, readyConversationRunner([]), () => { throw new Error('unused'); });
  assert.deepEqual((await restarted.ceoConversation()).messages.map((m) => m.status), ['outcome_unknown']);
  firstChild.stdout.emit('data', '{"type":"start","subtype":"init","session_id":"sess_abc123"}\n');
  firstChild.stdout.emit('data', '{"type":"text","text":"I coordinate Waypoint work."}\n');
  firstChild.stdout.emit('data', '{"type":"result","session_id":"sess_abc123","text":"I coordinate Waypoint work.","tokens":{"redactedByTest":true}}\n');
  firstChild.emit('close', 0);
  const firstResult = await first;
  assert.equal(firstResult.sessionId, 'sess_abc123');
  assert.equal(firstResult.reply, 'I coordinate Waypoint work.');
  assert.deepEqual(firstResult.messages.map((m) => m.role), ['user', 'ceo']);
  assert.deepEqual(firstResult.messages.map((m) => m.status), ['sent', 'confirmed']);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'hermes-ceo-conversation.json'), 'utf8'));
  assert.equal(stored.sessionId, 'sess_abc123');
  const state = JSON.parse(await fs.readFile(path.join(dir, 'hermes-ceo-state.json'), 'utf8'));
  assert.equal(state.conversationName, firstConversationName);

  const second = hermes.sendCeoMessage({ message: 'Again.' });
  await waitFor(() => spawns.length === 2);
  assert.ok(spawns[1].includes('--resume'));
  assert.equal(spawns[1][spawns[1].indexOf('--resume') + 1], 'sess_abc123');
  assert.ok(spawns[1].includes('--no-restore-cwd'));
  assert.equal(spawns[1].includes('--create-if-missing'), false);
  secondChild.stdout.emit('data', '{"type":"text","text":"Still coordinating."}\n');
  secondChild.stdout.emit('data', '{"type":"result","session_id":"sess_abc123","text":"Still coordinating."}\n');
  secondChild.emit('close', 0);
  const secondResult = await second;
  assert.equal(secondResult.sessionId, 'sess_abc123');
  assert.equal(secondResult.messages.length, 4);
});

test('CEO conversation errors and failed stderr are redacted from public errors', async () => {
  const child = new FakeChild();
  const { hermes, spawns } = await conversationHermes([child]);
  const promise = hermes.sendCeoMessage({ message: 'hello' });
  await waitFor(() => spawns.length === 1);
  child.stdout.emit('data', '{"type":"start","subtype":"init","session_id":"sess_failed"}\n');
  child.stderr.emit('data', 'provider failed with sk-secretsecretsecretsecretsecret');
  child.emit('close', 2);
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, 'lifecycle_error');
    assert.equal(error.details.outcomeUnknown, true);
    assert.equal(error.details.sessionId, 'sess_failed');
    assert.match(error.details.retry, /Do not automatically retry/);
    assert.equal(JSON.stringify(error).includes('sk-secret'), false);
    assert.equal(JSON.stringify(error).includes('provider failed'), false);
    return true;
  });
  const conversation = await hermes.ceoConversation();
  assert.equal(conversation.sessionId, 'sess_failed');
  assert.deepEqual(conversation.messages.map((m) => m.status), ['outcome_unknown', 'outcome_unknown']);
  assert.match(conversation.messages.at(-1).text, /Do not automatically retry/);
});

test('CEO conversation redacts bridge token and key-shaped text before returning or persisting replies', async () => {
  const child = new FakeChild();
  const { hermes, spawns, dir } = await conversationHermes([child]);
  const token = hermes.config.bridge.token;
  const promise = hermes.sendCeoMessage({ message: 'redaction check' });
  await waitFor(() => spawns.length === 1);
  child.stdout.emit('data', `{"type":"start","subtype":"init","session_id":"sess_redact"}\n`);
  child.stdout.emit('data', `${JSON.stringify({ type: 'result', session_id: 'sess_redact', text: `token ${token} Bearer abcdefghijklmnopqrstuvwxyz api_key=abcdefghijklmnop sk-secretsecret` })}\n`);
  child.emit('close', 0);
  const result = await promise;
  assert.equal(result.reply.includes(token), false);
  assert.equal(result.reply.includes('abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(result.reply.includes('abcdefghijklmnop'), false);
  assert.equal(result.reply.includes('sk-secretsecret'), false);
  const stored = await fs.readFile(path.join(dir, 'hermes-ceo-conversation.json'), 'utf8');
  assert.equal(stored.includes(token), false);
  assert.equal(stored.includes('abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(stored.includes('abcdefghijklmnop'), false);
  assert.equal(stored.includes('sk-secretsecret'), false);
});

test('CEO stream parser ignores tool and user events after a final result', async () => {
  const child = new FakeChild();
  const { hermes, spawns } = await conversationHermes([child]);
  const promise = hermes.sendCeoMessage({ message: 'tool output must not become reply' });
  await waitFor(() => spawns.length === 1);
  child.stdout.emit('data', '{"type":"start","subtype":"init","session_id":"sess_tool_skip"}\n');
  child.stdout.emit('data', '{"type":"result","session_id":"sess_tool_skip","text":"safe final"}\n');
  child.stdout.emit('data', '{"type":"tool_response","role":"tool","content":"Bearer should-not-be-reply"}\n');
  child.stdout.emit('data', '{"type":"user_message","role":"user","content":"user text should not win"}\n');
  child.stdout.emit('data', '{"type":"response.output_text.delta","delta":"delta should not win"}\n');
  child.emit('close', 0);
  const result = await promise;
  assert.equal(result.reply, 'safe final');
  assert.equal(result.messages.at(-1).status, 'confirmed');
});

test('CEO conversation enforces one active turn at a time', async () => {
  const child = new FakeChild();
  const { hermes, spawns } = await conversationHermes([child]);
  const first = hermes.sendCeoMessage({ message: 'first' });
  await assert.rejects(() => hermes.sendCeoMessage({ message: 'second' }), /already active/);
  await waitFor(() => spawns.length === 1);
  child.stdout.emit('data', '{"type":"start","subtype":"init","session_id":"sess_lock"}\n{"type":"result","session_id":"sess_lock","text":"done"}\n');
  child.emit('close', 0);
  await first;
});

test('CEO conversation times out bounded subprocess output', async () => {
  const child = new FakeChild();
  const { hermes, spawns } = await conversationHermes([child]);
  hermes.config.hermes.ceoTurnTimeoutMs = 10;
  const promise = hermes.sendCeoMessage({ message: 'timeout please' });
  await waitFor(() => spawns.length === 1);
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, 'timeout');
    assert.equal(error.details.outcomeUnknown, true);
    assert.match(error.details.retry, /Do not automatically retry/);
    assert.equal(child.killedSignal, 'SIGTERM');
    return true;
  });
});

test('CEO conversation rejects oversize messages before spawning Hermes', async () => {
  const child = new FakeChild();
  const { hermes, spawns } = await conversationHermes([child]);
  await assert.rejects(() => hermes.sendCeoMessage({ message: 'x'.repeat(4001) }), /too long/);
  assert.equal(spawns.length, 0);
});

test('bridge token persists across service config reloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-bridge-token-'));
  const one = loadConfig({ DATA_DIR: dir }, process.cwd());
  const two = loadConfig({ DATA_DIR: dir }, process.cwd());
  assert.equal(one.bridge.token, two.bridge.token);
  assert.match(await fs.readFile(path.join(dir, 'bridge-token'), 'utf8'), /^[0-9a-f]+\n$/i);
});

test('status does not claim provider connected from persisted UI toggles alone', async () => {
  const hermes = new HermesRuntime(config(), undefined, async (_command, args) => {
    if (args[0] === 'inspect') return { code: 1, stdout: '', stderr: 'No such object: waypoint-hermes-ceo' };
    return { code: 0, stdout: '', stderr: '' };
  });
  const status = await hermes.status();
  assert.equal(status.runtime.state, 'missing');
  assert.equal(status.model.configured, false);
  assert.equal(status.auth.anthropic.ready, false);
  assert.equal(status.auth['openai-codex'].ready, false);
  assert.equal(status.diagnostics.configAvailable, false);
});

function skillsRunner(calls, stdout, options = {}) {
  return async (command, args, runOptions = {}) => {
    calls.push({ command, args, options: runOptions });
    if (args[0] === 'inspect') {
      if (options.missing) return { code: 1, stdout: '', stderr: 'No such object: waypoint-hermes-ceo' };
      return { code: 0, stdout: '{"owned":"true","id":"c1","state":"running","running":true}\n', stderr: '' };
    }
    if (args[0] === 'exec' && args.includes('python3')) return { code: options.code ?? 0, stdout, stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
}

test('skills reads the native all-skill inventory and returns sanitized availability metadata only', async () => {
  const calls = [];
  const cfg = config();
  const native = { ok: true, skills: [
    { name: 'waypoint-ceo-bridge', description: 'Use for Waypoint CEO control-plane operations.', category: '', source: 'local', enabled: true, locked: true },
    { name: 'hermes-agent', description: 'Operate Hermes.', category: 'autonomous-ai-agents', source: 'builtin', enabled: true, locked: true },
    { name: 'codex', description: `Delegate coding\n\tto Codex. token=${'a'.repeat(20)} ${cfg.bridge.token}`, category: 'autonomous-ai-agents', source: 'builtin', enabled: false },
    { name: 'arxiv', description: 'Search papers.', category: 'research', source: 'hub', enabled: true },
    { name: '../escape', description: 'bad name', category: 'x', source: 'builtin', enabled: true },
    { name: 'odd', description: 'd'.repeat(400), category: 'bad category!', source: 'weird', enabled: true },
  ] };
  const hermes = new HermesRuntime(cfg, undefined, skillsRunner(calls, `platform warning\n${JSON.stringify(native)}\n`));
  const inventory = await hermes.skills();
  const exec = calls.find((c) => c.args[0] === 'exec');
  assert.deepEqual(exec.args.slice(0, 6), ['exec', '-i', '--user', 'hermes', 'waypoint-hermes-ceo', 'python3']);
  assert.match(exec.args.at(-1), /get_disabled_skills/);
  assert.ok(exec.options.outputLimitBytes > 8192);
  assert.equal(inventory.available, true);
  assert.equal(inventory.scope, 'ceo');
  assert.deepEqual(inventory.counts, { total: 5, enabled: 4, disabled: 1, locked: 2, builtin: 2, local: 2, hub: 1 });
  assert.deepEqual(inventory.skills.map((s) => s.name), ['odd', 'waypoint-ceo-bridge', 'codex', 'hermes-agent', 'arxiv']);
  const bridge = inventory.skills.find((s) => s.name === 'waypoint-ceo-bridge');
  assert.equal(bridge.waypoint, true);
  assert.equal(bridge.locked, true);
  const codex = inventory.skills.find((s) => s.name === 'codex');
  assert.equal(codex.waypoint, false);
  assert.equal(codex.enabled, false);
  assert.equal(codex.locked, false);
  assert.equal(codex.description.includes('\n'), false);
  assert.equal(codex.description.includes(cfg.bridge.token), false);
  assert.equal(codex.description.includes('a'.repeat(20)), false);
  const odd = inventory.skills.find((s) => s.name === 'odd');
  assert.equal(odd.category, '');
  assert.equal(odd.source, 'local');
  assert.equal(odd.description.length, 280);
  assert.deepEqual(Object.keys(codex).sort(), ['category', 'description', 'enabled', 'locked', 'name', 'source', 'waypoint']);
});

test('skills reports a stopped CEO without exec and fails closed on bad native output', async () => {
  const calls = [];
  const stopped = await new HermesRuntime(config(), undefined, skillsRunner(calls, '', { missing: true })).skills();
  assert.equal(stopped.available, false);
  assert.equal(stopped.skills.length, 0);
  assert.equal(calls.some((c) => c.args[0] === 'exec'), false);
  await assert.rejects(() => new HermesRuntime(config(), undefined, skillsRunner([], '{"ok":true,"skills":[{"na')).skills(), /unexpected shape/);
  await assert.rejects(() => new HermesRuntime(config(), undefined, skillsRunner([], '{"ok":false,"error":"ImportError"}')).skills(), /could not list/);
  await assert.rejects(() => new HermesRuntime(config(), undefined, skillsRunner([], '', { code: 1 })).skills(), /Hermes command failed/);
});

function mutableSkillsRunner(calls, initialDisabled = ['spike']) {
  const all = [
    { name: 'waypoint-ceo-bridge', description: 'Bridge.', category: '', source: 'local' },
    { name: 'hermes-agent', description: 'Hermes.', category: 'autonomous-ai-agents', source: 'builtin' },
    { name: 'spike', description: 'Experiment.', category: 'software-development', source: 'builtin' },
  ];
  const disabled = new Set(initialDisabled);
  const payload = () => ({ ok: true, skills: all.map((skill) => ({ ...skill, enabled: !disabled.has(skill.name), locked: ['waypoint-ceo-bridge', 'hermes-agent'].includes(skill.name) })) });
  return async (_command, args, options = {}) => {
    calls.push({ args, input: options.input });
    if (args[0] === 'inspect') return { code: 0, stdout: '{"owned":"true","id":"c1","state":"running","running":true}\n', stderr: '' };
    if (args[0] === 'exec' && args.includes('python3')) {
      const script = String(args.at(-1));
      if (script.includes('save_disabled_skills')) {
        const body = JSON.parse(options.input || '{}');
        if (!all.some((skill) => skill.name === body.name)) return { code: 0, stdout: '{"ok":false,"error":"not_found"}\n', stderr: '' };
        if (body.enabled) disabled.delete(body.name); else disabled.add(body.name);
        return { code: 0, stdout: `${JSON.stringify(payload())}\n`, stderr: '' };
      }
      if (script.includes('find_skill_root')) {
        const body = JSON.parse(options.input || '{}');
        if (!all.some((skill) => skill.name === body.name)) return { code: 0, stdout: '{"ok":false,"error":"not_found"}\n', stderr: '' };
        return { code: 0, stdout: JSON.stringify({ ok: true, skill: { ...payload().skills.find((skill) => skill.name === body.name), overview: `Token ${'z'.repeat(24)} ${body.name}`, files: [{ name: 'SKILL.md', size: 120 }, { name: 'secrets.env', size: 99 }, { name: '../escape', size: 1 }] } }) + '\n', stderr: '' };
      }
      return { code: 0, stdout: `${JSON.stringify(payload())}\n`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
}

test('skill availability toggles native disabled state, validates names, and serializes writes', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, mutableSkillsRunner(calls));
  const enabled = await hermes.setSkillEnabled('spike', { enabled: true });
  assert.equal(enabled.skill.name, 'spike');
  assert.equal(enabled.skill.enabled, true);
  assert.equal(enabled.counts.disabled, 0);
  await assert.rejects(() => hermes.setSkillEnabled('../escape', { enabled: false }), /invalid shape/);
  await assert.rejects(() => hermes.setSkillEnabled('missing', { enabled: false }), /not found/);
  await assert.rejects(() => hermes.setSkillEnabled('waypoint-ceo-bridge', { enabled: false }), /locked/);
  await assert.rejects(() => hermes.setSkillEnabled('spike', { enabled: 'false' }), /boolean/);
  const update = calls.find((c) => c.args?.[0] === 'exec' && String(c.args.at(-1)).includes('save_disabled_skills'));
  assert.match(update.args.at(-1), /load_config/);
  assert.match(update.args.at(-1), /save_disabled_skills/);
  assert.equal(String(update.input).includes('../escape'), false);
});

test('skill detail returns bounded redacted metadata and safe relative files only', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, mutableSkillsRunner(calls));
  const detail = await hermes.skill('spike');
  assert.equal(detail.skill.name, 'spike');
  assert.equal(detail.skill.enabled, false);
  assert.equal(detail.skill.overview.includes('z'.repeat(24)), false);
  assert.deepEqual(detail.skill.files, [{ name: 'SKILL.md', size: 120 }]);
  assert.equal(JSON.stringify(detail).includes('secrets.env'), false);
  await assert.rejects(() => hermes.skill('missing'), /not found/);
});

test('CEO skill seed describes native seats, the board, and the bridge tools', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, async (command, args, options = {}) => {
    calls.push({ command, args, options });
    return { code: 0, stdout: '', stderr: '' };
  });
  await hermes.seedCeoHome();
  const script = String(calls[0].args.at(-1));
  assert.equal(JSON.parse(calls[0].options.input).bridgeToken, hermes.config.bridge.token, 'token travels on stdin, never in the script');
  assert.equal(script.includes(hermes.config.bridge.token), false);
  const { spawnSync } = await import('node:child_process');
  const python = ['python3', 'python'].find((bin) => spawnSync(bin, ['-c', 'pass'], { stdio: 'ignore' }).status === 0);
  if (python) assert.equal(spawnSync(python, ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: script }).status, 0, 'seed script stays valid Python');
  const literal = script.split('\n').find((line) => line.startsWith('skill="')).slice('skill='.length);
  const skill = JSON.parse(literal);
  assert.match(skill, /^---\nname: waypoint-ceo-bridge\ndescription: .*seats, the task board, missions, and projects\.\n---\n/);
  assert.match(skill, /Seats are Hermes profiles in your own install/);
  assert.match(skill, /Delegate work as kanban tasks assigned to the best seat/);
  assert.match(skill, /queue the next step as a child task that starts once the user approves/);
  assert.match(skill, /update_mission \{ missionId, status \}/);
  assert.doesNotMatch(skill, /pod_start|run_task|send_message|create_task/, 'no legacy pod or task tools');
  assert.doesNotMatch(script, /waypoint-github|gh (pr|issue|auth)|GitHub CLI/, 'GitHub usage is left to the model');
  assert.match(script, /name = ceo \(Waypoint\)/);
});

test('CEO task threads use their own session, task context, and live tool activity', async () => {
  const general = new FakeChild();
  const taskChild = new FakeChild();
  const { hermes, spawns, dir } = await conversationHermes([taskChild, general]);
  const threadId = 't_1a2b3c4d';
  const turn = hermes.sendCeoMessage({ message: 'Plan it.', threadId, context: 'This conversation is about Waypoint task SUN-1: Ship it' });
  await waitFor(() => spawns.length === 1);
  assert.equal(spawns[0][spawns[0].indexOf('--continue') + 1], `waypoint-ceo-${threadId}`);
  assert.equal(taskChild.stdinText, 'This conversation is about Waypoint task SUN-1: Ship it\n\nPlan it.');
  taskChild.stdout.emit('data', '{"type":"system","subtype":"init","session_id":"sess_task1"}\n{"type":"tool_use","name":"terminal","tool_call_id":"c1","input":{"command":"curl -H \\"Authorization: Bearer abcdefghijklmnop1234\\" bridge"}}\n');
  hermes.recordCeoAction('create_task', 'SUN-2 Write tests');
  let live = await hermes.ceoConversation(threadId);
  assert.equal(live.busyThreadId, threadId);
  assert.deepEqual(live.live.items.map((item) => [item.kind, item.name, item.status]), [['tool', 'terminal', 'running'], ['action', 'create_task', 'ok']]);
  assert.equal(live.live.items[0].detail.includes('abcdefghijklmnop1234'), false);
  assert.equal((await hermes.ceoConversation()).live, null);
  taskChild.stdout.emit('data', '{"type":"tool_result","name":"terminal","tool_call_id":"c1","output":"secret output","duration_ms":42,"is_error":false}\n');
  taskChild.stdout.emit('data', '{"type":"result","session_id":"sess_task1","text":"Planned."}\n');
  taskChild.emit('close', 0);
  const result = await turn;
  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'activity', 'ceo']);
  assert.equal(result.messages[0].text, 'Plan it.');
  assert.deepEqual(result.messages[1].items[0], { kind: 'tool', name: 'terminal', detail: result.messages[1].items[0].detail, status: 'ok', durationMs: 42 });
  assert.equal(JSON.stringify(result.messages).includes('secret output'), false);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'ceo-threads', `${threadId}.json`), 'utf8'));
  assert.equal(stored.sessionId, 'sess_task1');
  assert.equal((await hermes.ceoConversation()).messages.length, 0);
  const { threads, busyThreadId } = await hermes.listCeoThreads();
  assert.equal(busyThreadId, null);
  assert.deepEqual(threads.map((t) => [t.threadId, t.messageCount]), [['general', 0], [threadId, 2]]);
  hermes.recordCeoAction('create_task', 'ignored outside a turn');
  await assert.rejects(hermes.sendCeoMessage({ message: 'x', threadId: '../etc' }), /threadId/);
});

test('CEO home seed installs the onboarding skill and lists it as a Waypoint skill', async () => {
  const calls = [];
  const hermes = new HermesRuntime(config(), undefined, async (command, args, options = {}) => {
    calls.push({ command, args, options });
    return { code: 0, stdout: '', stderr: '' };
  });
  await hermes.seedCeoHome();
  const payload = JSON.parse(calls[0].options.input);
  assert.match(payload.onboardingSkill, /^---\nname: waypoint-onboarding\n/);
  assert.match(payload.onboardingSkill, /Never create, start, or run anything without the user's explicit approval/);
  assert.match(payload.onboardingSkill, /Ask exactly one question per message and put it at the end/);
  const script = String(calls[0].args.at(-1));
  assert.ok(script.includes("os.path.join(home,'skills','waypoint-onboarding')"));
});
