import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { PodStore } from './store.js';
import { DockerAdapter } from './docker.js';
import { HermesRuntime } from './hermes.js';
import { PodSeats } from './podSeats.js';
import { PodSeatAuth } from './podSeatAuth.js';
import { PodTaskExecutor, podSeatsReadiness } from './podTaskExecutor.js';
import { TaskRunService } from './taskRuns.js';
import { MessagingService } from './messaging.js';
import { MessageWakeService } from './messageWakes.js';
import { createBridgeHandler, createHandler } from './routes.js';
import { listenControl } from './controlChannel.js';

export async function createApp(env = process.env) {
  const config = loadConfig(env, process.cwd());
  const logger = createLogger({ serviceName: config.serviceName, level: config.logLevel });
  const store = new PodStore(config.dataDir);
  await store.ensure();
  const messaging = await MessagingService.create({ config, store });

  const interrupted = await store.markInterruptedTaskRuns();
  if (interrupted.length) logger.warn('task_runs_interrupted', { count: interrupted.length, taskIds: interrupted.map((item) => item.taskId) });
  const docker = new DockerAdapter(config, logger);
  const hermes = new HermesRuntime(config, logger);
  const podSeats = new PodSeats({ config, docker, logger });
  const podSeatAuth = new PodSeatAuth({ config, docker, podSeats, logger });

  const taskExecutor = new PodTaskExecutor({ config, docker, readiness: podSeatsReadiness(podSeats), logger });
  const taskRuns = new TaskRunService({ config, store, executor: taskExecutor, logger });
  const messageWakes = new MessageWakeService({ config, messaging, store, hermes, executor: taskExecutor, logger });
  if (config.hermes.autoStart) {
    void hermes.reconcileStartup()
      .then((result) => logger.info('hermes_reconciled', { action: result.action, executed: result.executed, state: result.status?.state, running: result.status?.running }))
      .catch((error) => logger.warn('hermes_reconcile_skipped', { message: error.message }));
  }

  const server = http.createServer(createHandler({ config, store, docker, hermes, podSeats, podSeatAuth, taskRuns, messaging, logger }));
  const bridgeServer = http.createServer(createBridgeHandler({ config, store, docker, hermes, podSeats, taskRuns, messaging, logger }));
  return { config, logger, store, docker, hermes, podSeats, podSeatAuth, taskExecutor, taskRuns, messaging, messageWakes, server, bridgeServer };
}
export async function main() {
  const { server, bridgeServer, config, logger, messageWakes } = await createApp();

  await new Promise((resolve, reject) => {
    bridgeServer.once('error', reject);
    bridgeServer.listen(config.port, config.host, resolve);
  });
  await listenControl(server, config.control);
  await messageWakes.start();
  logger.info('service_started', { bridge: { host: config.host, port: config.port }, control: { transport: config.control.transport, path: config.control.socketPath }, dryRun: config.dryRun });
  const shutdown = (signal) => {
    logger.info('shutdown_started', { signal });
    messageWakes.stop();
    const close = (s) => new Promise((resolve) => s.close((error) => resolve(error)));
    Promise.all([close(server), close(bridgeServer)]).then((errors) => {
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
