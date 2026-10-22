import net from 'node:net';
import { badRequest, conflict, lifecycleError } from './errors.js';

const DASHBOARD_PORT = 9119;
const SEAT_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const READY_ATTEMPTS = 60;
const READY_DELAY_MS = 500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HermesPortal {
  constructor({ config, hermes, logger = undefined, readyDelayMs = READY_DELAY_MS, dashboardPort = DASHBOARD_PORT }) {
    this.dashboardPort = dashboardPort;
    this.config = config;
    this.hermes = hermes;
    this.logger = logger;
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
    await this.#stopDashboard();
    await this.#startDashboard(target);
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
      await this.#stopDashboard().catch(() => undefined);
      this.logger?.info?.('hermes_portal_closed', { target: previous.target, reason });
    }
    return this.status();
  }

  async resolveTarget(input) {
    const target = String(input || '');
    if (target === 'ceo') {
      const inspected = await this.hermes.inspect({ allowMissing: true });
      if (!inspected.exists || !inspected.state.running) throw conflict('The Hermes CEO must be running to open its dashboard.');
      return { target, profile: null };
    }
    if (!SEAT_ID_RE.test(target)) throw badRequest('target must be ceo or a seat id');
    const inspected = await this.hermes.inspect({ allowMissing: true });
    if (!inspected.exists || !inspected.state.running) throw conflict('The Hermes CEO must be running to open a seat dashboard.');
    return { target, profile: target };
  }

  #stopDashboard() {
    return this.hermes.runHermes(['dashboard', '--stop'], { timeoutMs: 20000, outputLimitBytes: 4096 });
  }

  async #startDashboard(target) {
    const command = this.hermes.host.hermesDetached([...(target.profile ? ['-p', target.profile] : []), 'dashboard', '--no-open', '--skip-build', '--port', String(this.dashboardPort), '--host', '127.0.0.1']);
    const child = this.hermes.spawnHermes(command);
    child.on?.('error', () => undefined);
    child.unref?.();
  }

  #ready() {
    return fetch(`http://127.0.0.1:${this.dashboardPort}/`, { signal: AbortSignal.timeout(2000) }).then((response) => response.status === 200, () => false);
  }

  async #waitReady(target) {
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      if (await this.#ready()) return;
      await delay(this.readyDelayMs);
    }
    await this.#stopDashboard().catch(() => undefined);
    throw lifecycleError('Hermes dashboard did not become ready', { target: target.target });
  }

  #upstream() {
    const socket = net.connect(this.dashboardPort, '127.0.0.1');
    return { input: socket, output: socket, events: socket, kill: () => socket.destroy() };
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
    const upstream = this.#upstream();
    socket.pipe(upstream.input);
    upstream.output.pipe(socket);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this.sockets.delete(socket);
      socket.destroy();
      upstream.kill();
      if (this.active) this.#touch();
    };
    upstream.events.on('close', end);
    upstream.events.on('error', end);
    upstream.input.on('error', end);
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
