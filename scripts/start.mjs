import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const serviceDir = path.join(root, 'service');
const appUrl = (process.env.WAYPOINT_APP_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '');
const openBrowser = !process.argv.includes('--no-open');
const children = new Set();
let stopping = false;

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
  const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  prefixLines(child.stdout, label, onLine);
  prefixLines(child.stderr, label, onLine);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.error(`[waypoint] ${label} stopped (${signal || `exit ${code}`}). Stopping everything.`);
    stop(code || 1);
  });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 500).unref();
  if (!children.size) process.exit(code);
  for (const child of children) child.on('exit', () => { if (!children.size) process.exit(code); });
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

for (const dir of [appDir]) {
  if (!existsSync(path.join(dir, 'node_modules'))) {
    console.error(`[waypoint] Dependencies are missing in ${path.relative(root, dir)}. Run: npm install --prefix ${path.relative(root, dir)}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

let serviceReady = false;
run('service', ['--env-file-if-exists=.env', 'src/index.js'], serviceDir, (line) => {
  if (line.includes('"service_started"')) serviceReady = true;
});
if (!await waitFor(() => serviceReady, 30000)) {
  if (!stopping) { console.error('[waypoint] The service did not start within 30 seconds.'); stop(1); }
} else {
  run('app', [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', new URL(appUrl).port || '5173'], appDir);
  const appUp = await waitFor(() => fetch(appUrl, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false), 30000);
  if (!appUp) {
    if (!stopping) { console.error(`[waypoint] The app did not answer at ${appUrl} within 30 seconds.`); stop(1); }
  } else {
    console.log(`[waypoint] Ready at ${appUrl}. Press Ctrl+C to stop.`);
    if (openBrowser) spawn(process.execPath, [path.join('scripts', 'open.mjs')], { cwd: appDir, env: process.env, stdio: 'inherit' });
  }
}
