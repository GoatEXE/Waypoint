import net from 'node:net';
import { spawn } from 'node:child_process';
import { badRequest, conflict, lifecycleError } from './errors.js';

const DASHBOARD_PORT = 9119;
const SEAT_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const READY_ATTEMPTS = 60;
const READY_DELAY_MS = 500;

export const PORTAL_RELAY_SCRIPT = String.raw`
import os, socket, sys, threading
s = socket.create_connection(('127.0.0.1', int(sys.argv[1])), timeout=10)
s.settimeout(None)
def up():
    try:
        while True:
            data = os.read(0, 65536)
            if not data: break
            s.sendall(data)
    finally:
        try: s.shutdown(socket.SHUT_WR)
        except OSError: pass
threading.Thread(target=up, daemon=True).start()
while True:
    data = s.recv(65536)
    if not data: break
    os.write(1, data)
`;

const READY_SCRIPT = `import urllib.request,sys
try: sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${DASHBOARD_PORT}/', timeout=2).status == 200 else 1)
except Exception: sys.exit(1)`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HermesPortal {
  constructor({ config, hermes, logger = undefined, spawner = spawn, readyDelayMs = READY_DELAY_MS }) {
    this.config = config;
    this.hermes = hermes;
    this.logger = logger;
    this.spawner = spawner;
    this.readyDelayMs = readyDelayMs;
    this.active = null;
    this.server = null;
    this.sockets = new Set();
    this.idleTimer = null;
    this.queue = Promise.resolve();
  }

  get url() { return `http://127.0.0.1:${this.config.hermes.portalPort}/`; }

  status() {
    return this.active ? { open: true, target: this.active.target, url: this.url, openedAt: this.active.openedAt } : { open: false, target: null, url: null, openedAt: null };
  }

  open(target) { return this.#serialize(() => this.#open(target)); }
  close(reason = 'closed') { return this.#serialize(() => this.#close(reason)); }

  async #open(input) {
    const target = await this.resolveTarget(input);
    if (this.config.dryRun) throw conflict('Waypoint is in dry-run mode; Hermes dashboards cannot be started.');
    if (this.active?.target === target.target) {
      this.#touch();
      return this.status();
    }
    await this.#close('switched');
    await this.#exec(target, ['hermes', 'dashboard', '--stop'], 20000);
    const start = await this.hermes.runner('docker', ['exec', '-d', '--user', 'hermes', target.containerName, 'hermes', ...(target.profile ? ['-p', target.profile] : []), 'dashboard', '--no-open', '--skip-build', '--port', String(DASHBOARD_PORT), '--host', '127.0.0.1'], { timeoutMs: 20000, outputLimitBytes: 4096 });
    if (start.code !== 0) throw lifecycleError('Hermes dashboard could not be started', { target: target.target });
    await this.#waitReady(target);
    await this.#listen();
    this.active = { ...target, openedAt: new Date().toISOString() };
    this.#touch();
    this.logger?.info?.('hermes_portal_opened', { target: target.target });
    return this.status();
  }

  async #close(reason) {
    const previous = this.active;
    this.active = null;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise((resolve) => server.close(() => resolve()));
    }
    if (previous) {
      await this.#exec(previous, ['hermes', 'dashboard', '--stop'], 20000).catch(() => undefined);
      this.logger?.info?.('hermes_portal_closed', { target: previous.target, reason });
    }
    return this.status();
  }

  async resolveTarget(input) {
    const target = String(input || '');
    if (target === 'ceo') {
      const inspected = await this.hermes.inspect({ allowMissing: true });
      if (!inspected.exists || !inspected.state.running) throw conflict('Hermes CEO container must be running to open its dashboard.');
      return { target, containerName: this.hermes.containerName, profile: null };
    }
    if (!SEAT_ID_RE.test(target)) throw badRequest('target must be ceo or a seat id');
    const inspected = await this.hermes.inspect({ allowMissing: true });
    if (!inspected.exists || !inspected.state.running) throw conflict('Hermes CEO container must be running to open a seat dashboard.');
    return { target, containerName: this.hermes.containerName, profile: target };
  }

  async #exec(target, command, timeoutMs) {
    return this.hermes.runner('docker', ['exec', '--user', 'hermes', target.containerName, ...command], { timeoutMs, outputLimitBytes: 4096 });
  }

  async #waitReady(target) {
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      const probe = await this.#exec(target, ['python3', '-c', READY_SCRIPT], 10000);
      if (probe.code === 0) return;
      await delay(this.readyDelayMs);
    }
    await this.#exec(target, ['hermes', 'dashboard', '--stop'], 20000).catch(() => undefined);
    throw lifecycleError('Hermes dashboard did not become ready', { target: target.target });
  }

  async #listen() {
    if (this.server) return;
    const server = net.createServer((socket) => this.#relay(socket));
    await new Promise((resolve, reject) => {
      server.once('error', (error) => reject(error.code === 'EADDRINUSE' ? conflict(`Port ${this.config.hermes.portalPort} is in use; set HERMES_PORTAL_PORT to a free port.`) : error));
      server.listen(this.config.hermes.portalPort, '127.0.0.1', resolve);
    });
    server.unref();
    this.server = server;
  }

  #relay(socket) {
    const active = this.active;
    if (!active) { socket.destroy(); return; }
    this.sockets.add(socket);
    this.#touch();
    const child = this.spawner('docker', ['exec', '-i', '--user', 'hermes', active.containerName, 'python3', '-c', PORTAL_RELAY_SCRIPT, String(DASHBOARD_PORT)], { stdio: ['pipe', 'pipe', 'ignore'] });
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this.sockets.delete(socket);
      socket.destroy();
      child.kill();
      if (this.active) this.#touch();
    };
    child.on('close', end);
    child.on('error', end);
    child.stdin.on('error', end);
    socket.on('close', end);
    socket.on('error', end);
  }

  #touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.sockets.size) { this.#touch(); return; }
      void this.close('idle');
    }, this.config.hermes.portalIdleMs);
    this.idleTimer.unref?.();
  }

  #serialize(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }
}
