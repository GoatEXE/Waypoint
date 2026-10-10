import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { OrgStore } from './store.js';
import { HermesRuntime } from './hermes.js';
import { OrganizationStore } from './organization.js';
import { GitHubConnector } from './github.js';
import { HermesPortal } from './hermesPortal.js';
import { OrgSeats } from './orgSeats.js';
import { KanbanBoard } from './kanban.js';
import { Pods } from './pods.js';
import { SeatFeedback } from './seatFeedback.js';
import { createBridgeHandler, createHandler } from './routes.js';
import { listenControl } from './controlChannel.js';

export async function createApp(env = process.env) {
  const config = loadConfig(env, process.cwd());
  const logger = createLogger({ serviceName: config.serviceName, level: config.logLevel });
  const store = new OrgStore(config.dataDir);
  await store.ensure();
  const organization = new OrganizationStore(config.dataDir);
  const hermes = new HermesRuntime(config, logger);
  hermes.organization = organization;
  const github = new GitHubConnector({ config });
  const portal = new HermesPortal({ config, hermes, logger });
  const orgSeats = new OrgSeats({ config, hermes });
  const board = new KanbanBoard({ config, hermes, organization });
  const pods = new Pods({ config, hermes, board, orgSeats });
  orgSeats.excluded = () => pods.seatIds();
  const seatFeedback = new SeatFeedback({ config, hermes, board });
  if (config.hermes.autoStart) {
    void hermes.reconcileStartup()
      .then((result) => logger.info('hermes_reconciled', { action: result.action, executed: result.executed, state: result.status?.state, running: result.status?.running }))
      .catch((error) => logger.warn('hermes_reconcile_skipped', { message: error.message }));
  }

  const context = { config, store, organization, hermes, board, pods, github, portal, orgSeats, seatFeedback, logger };
  const server = http.createServer(createHandler(context));
  const bridgeServer = http.createServer(createBridgeHandler(context));
  return { ...context, server, bridgeServer };
}

export async function main() {
  const { server, bridgeServer, config, logger, portal } = await createApp();

  await new Promise((resolve, reject) => {
    bridgeServer.once('error', reject);
    bridgeServer.listen(config.port, config.host, resolve);
  });
  await listenControl(server, config.control);
  logger.info('service_started', { bridge: { host: config.host, port: config.port }, control: { transport: config.control.transport, path: config.control.socketPath }, dryRun: config.dryRun });
  const shutdown = (signal) => {
    logger.info('shutdown_started', { signal });
    const close = (s) => new Promise((resolve) => s.close((error) => resolve(error)));
    Promise.all([close(server), close(bridgeServer), portal.close('shutdown').then(() => null, (error) => error)]).then((errors) => {
      const error = errors.find(Boolean);
      if (error) logger.error('shutdown_error', { message: error.message });
      logger.info('shutdown_complete');
      process.exit(error ? 1 : 0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(JSON.stringify({ level: 'error', event: 'startup_failed', message: error.message }));
    process.exit(1);
  });
}
