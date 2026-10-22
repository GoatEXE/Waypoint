import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GITHUB_SHIM = fileURLToPath(new URL('./waypoint_github.py', import.meta.url));

export function createHermesHost(config) {
  return new NativeHost(config);
}

export class NativeHost {
  constructor(config) {
    this.config = config;
    this.home = config.hermes.home;
  }

  get bin() { return this.config.hermes.bin; }

  runtime() {
    this.resolved ||= this.config.hermes.python ? { python: this.config.hermes.python, flags: ['-X', 'utf8'], prelude: '' } : resolveRuntime(this.bin);
    return this.resolved;
  }

  get binDir() { return path.join(this.home, 'waypoint', 'bin'); }

  get realGh() {
    if (this.ghPath === undefined) this.ghPath = whichSync('gh');
    return this.ghPath;
  }

  env() {
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
    const python = slash(this.runtime().python);
    return {
      ...process.env,
      [pathKey]: [this.binDir, process.env[pathKey]].filter(Boolean).join(path.delimiter),
      HERMES_HOME: this.home,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      NO_COLOR: '1',
      WAYPOINT_BRIDGE_FILE: path.join(this.home, 'waypoint', 'bridge.json'),
      ...(this.realGh ? { WAYPOINT_REAL_GH: this.realGh } : {}),
      GIT_CONFIG_GLOBAL: path.join(this.home, 'home', '.gitconfig'),
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: `!"${python}" "${slash(GITHUB_SHIM)}" credential`,
      GIT_CONFIG_KEY_2: 'credential.https://github.com.useHttpPath',
      GIT_CONFIG_VALUE_2: 'true',
    };
  }

  installShims() {
    fs.mkdirSync(this.binDir, { recursive: true });
    const python = this.runtime().python;
    if (process.platform === 'win32') fs.writeFileSync(path.join(this.binDir, 'gh.cmd'), `@echo off\r\n"${python}" "${GITHUB_SHIM}" gh %*\r\n`);
    else fs.writeFileSync(path.join(this.binDir, 'gh'), `#!/bin/sh\nexec "${python}" "${GITHUB_SHIM}" gh "$@"\n`, { mode: 0o755 });
  }

  gh(args) {
    return { command: this.runtime().python, args: [GITHUB_SHIM, 'gh', ...args], options: { env: this.env(), windowsHide: true } };
  }

  hermes(args) {
    return { command: this.bin, args, options: { env: this.env(), windowsHide: true } };
  }

  python(script, args = []) {
    const { python, flags, prelude } = this.runtime();
    return { command: python, args: [...flags, '-c', prelude ? `${prelude}\n${script}` : script, ...args], options: { env: this.env(), windowsHide: true } };
  }

  hermesDetached(args) {
    return { command: this.bin, args, options: { env: this.env(), windowsHide: true, detached: true, stdio: 'ignore' } };
  }
}

const RUN_MAIN = 'runpy.run_module(';

export function runtimeFromLauncher(stdout) {
  let argv;
  try { argv = JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop()); } catch { return null; }
  if (!Array.isArray(argv) || argv.length < 3 || argv.at(-2) !== '-c' || !argv.every((part) => typeof part === 'string')) return null;
  const code = argv.at(-1);
  const at = code.lastIndexOf(RUN_MAIN);
  if (at < 0) return null;
  return { python: argv[0], flags: [...argv.slice(1, -2), '-X', 'utf8'], prelude: code.slice(0, at) };
}

function resolveRuntime(bin) {
  const printed = spawnSync(bin, ['--print-runtime-command'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const runtime = printed.status === 0 ? runtimeFromLauncher(printed.stdout) : null;
  return runtime || { python: resolvePython(bin), flags: ['-X', 'utf8'], prelude: '' };
}

export function resolvePython(bin) {
  const found = whichSync(bin);
  if (found) {
    const dir = path.dirname(fs.realpathSync(found));
    for (const name of process.platform === 'win32' ? ['python.exe'] : ['python3', 'python']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function whichSync(bin) {
  if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : '';
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? String(result.stdout).split(/\r?\n/)[0].trim() : '';
}

function slash(value) {
  return String(value).replaceAll('\\', '/');
}

export function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill(signal);
}
