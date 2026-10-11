import { execFileSync, spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveControlChannel } from '../service/src/controlChannel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const serviceDir = path.join(root, 'service');
const appUrl = (process.env.WAYPOINT_APP_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '');
const openBrowser = !process.argv.includes('--no-open');
const controlDir = resolveControlChannel(process.env).dir;
const requestFile = path.join(controlDir, 'update-request.json');
const resultFile = path.join(controlDir, 'update-result.json');
const childEnv = { ...process.env, WAYPOINT_LAUNCHER: '1' };
const children = new Set();
let stopping = false;
let restarting = false;

function prefixLines(stream, label, onLine) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) process.stdout.write(`[${label}] ${line}\n`);
      onLine?.(line);
    }
  });
}

function run(label, args, cwd, onLine) {
  const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  prefixLines(child.stdout, label, onLine);
  prefixLines(child.stderr, label, onLine);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (stopping || restarting) return;
    console.error(`[waypoint] ${label} stopped (${signal || `exit ${code}`}). Stopping everything.`);
    stop(code || 1);
  });
  return child;
}

function stopChildren() {
  return new Promise((resolve) => {
    if (!children.size) { resolve(); return; }
    for (const child of children) {
      child.on('exit', () => { if (!children.size) resolve(); });
      child.kill();
    }
    setTimeout(resolve, 5000).unref();
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  void stopChildren().then(() => process.exit(code));
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) return false;
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function startAll() {
  let serviceReady = false;
  run('service', ['--env-file-if-exists=.env', 'src/index.js'], serviceDir, (line) => {
    if (line.includes('"service_started"')) serviceReady = true;
  });
  if (!await waitFor(() => serviceReady, 30000)) {
    if (!stopping) { console.error('[waypoint] The service did not start within 30 seconds.'); stop(1); }
    return false;
  }
  run('app', [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', new URL(appUrl).port || '5173'], appDir);
  const appUp = await waitFor(() => fetch(appUrl, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false), 30000);
  if (!appUp) {
    if (!stopping) { console.error(`[waypoint] The app did not answer at ${appUrl} within 30 seconds.`); stop(1); }
    return false;
  }
  return true;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function npmInstall(dir) {
  console.log(`[waypoint] Installing dependencies in ${path.relative(root, dir)}…`);
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
}

async function update() {
  restarting = true;
  const at = new Date().toISOString();
  const from = git(['rev-parse', '--short', 'HEAD']);
  let result;
  try {
    console.log('[waypoint] Updating: stopping the service and app.');
    await stopChildren();
    git(['pull', '--ff-only', 'origin', 'main']);
    const to = git(['rev-parse', '--short', 'HEAD']);
    const changed = from === to ? [] : git(['diff', '--name-only', `${from}..${to}`]).split('\n');
    for (const dir of ['app', 'service']) if (changed.includes(`${dir}/package-lock.json`)) npmInstall(path.join(root, dir));
    result = { ok: true, at, from, to };
    console.log(`[waypoint] Updated ${from} → ${to}. Restarting.`);
  } catch (error) {
    result = { ok: false, at, from, to: from, error: String(error.stderr || error.message || error).trim().split('\n').pop().slice(0, 300) };
    console.error(`[waypoint] Update failed: ${result.error}. Restarting the current version.`);
  }
  writeFileSync(resultFile, `${JSON.stringify(result)}\n`);
  restarting = false;
  await startAll();
}

function watchForUpdates() {
  setInterval(() => {
    if (stopping || restarting || !existsSync(requestFile)) return;
    rmSync(requestFile, { force: true });
    void update();
  }, 1000).unref?.();
}

for (const dir of [appDir]) {
  if (!existsSync(path.join(dir, 'node_modules'))) {
    console.error(`[waypoint] Dependencies are missing in ${path.relative(root, dir)}. Run: npm install --prefix ${path.relative(root, dir)}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

rmSync(requestFile, { force: true });
if (await startAll()) {
  console.log(`[waypoint] Ready at ${appUrl}. Press Ctrl+C to stop.`);
  if (openBrowser) spawn(process.execPath, [path.join('scripts', 'open.mjs')], { cwd: appDir, env: process.env, stdio: 'inherit' });
  watchForUpdates();
}
