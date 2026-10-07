import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveControlChannel } from './controlChannel.js';

export const PINNED_HERMES_IMAGE = 'nousresearch/hermes-agent@sha256:d4da4a40cd7a28aba983775d9fd31d94cbf153eeb0cb9e844d6d0f612b7c24db';
function loadOrCreateBridgeToken(dataDir) {
  const tokenPath = path.join(dataDir, 'bridge-token');
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (/^[0-9a-f-]{32,64}$/i.test(existing)) return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const token = randomUUID().replaceAll('-', '');
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600, flag: 'w' });
  try { fs.chmodSync(tokenPath, 0o600); } catch { /* Windows may ignore POSIX mode */ }
  return token;
}

function boolFromEnv(name, value, defaultValue) {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean value: true/false, yes/no, on/off, or 1/0`);
}
function intFromEnv(name, value, defaultValue, min, max) {
  const parsed = Number.parseInt(value || String(defaultValue), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return parsed;
}
const DOCKER_NAME_SEGMENT_RE = /^[a-z][a-z0-9_.-]{0,62}$/;
const LABEL_NAMESPACE_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
function dockerNameSegmentFromEnv(name, value, defaultValue) {
  const text = String(value || defaultValue).trim();
  if (!DOCKER_NAME_SEGMENT_RE.test(text)) throw new Error(`${name} must start with a lowercase letter and contain only lowercase letters, digits, dot, dash, or underscore`);
  return text;
}
function labelNamespaceFromEnv(name, value, defaultValue) {
  const text = String(value || defaultValue).trim();
  if (!LABEL_NAMESPACE_RE.test(text)) throw new Error(`${name} must be a lowercase Docker label namespace`);
  return text;
}
export function loadConfig(env = process.env, cwd = process.cwd()) {
  const port = intFromEnv('PORT', env.PORT, 3080, 1, 65535);
  const dataDir = path.resolve(cwd, env.DATA_DIR || './runtime/pod');
  return {
    serviceName: env.SERVICE_NAME || 'waypoint-pod-service',
    host: env.HOST || '127.0.0.1',
    port,
    logLevel: env.LOG_LEVEL || 'info',
    dataDir,
    dryRun: boolFromEnv('DRY_RUN', env.DRY_RUN, true),
    sharedAuth: {
      enabled: boolFromEnv('WAYPOINT_SHARED_AUTH', env.WAYPOINT_SHARED_AUTH, false),
      volumeName: dockerNameSegmentFromEnv('WAYPOINT_AUTH_VOLUME', env.WAYPOINT_AUTH_VOLUME, 'waypoint-hermes-shared-auth'),
      mountPath: '/opt/waypoint-auth',
    },
    docker: {
      image: env.POD_DOCKER_IMAGE || PINNED_HERMES_IMAGE,
      labelNamespace: labelNamespaceFromEnv('POD_LABEL_NAMESPACE', env.POD_LABEL_NAMESPACE, 'com.waypoint.pod'),
      namePrefix: dockerNameSegmentFromEnv('POD_NAME_PREFIX', env.POD_NAME_PREFIX, 'waypoint-pod'),
      volumePrefix: dockerNameSegmentFromEnv('POD_VOLUME_PREFIX', env.POD_VOLUME_PREFIX, 'waypoint-pod-data'),
      idleCommand: ['sleep', 'infinity'],
    },
    hermes: {
      image: env.HERMES_DOCKER_IMAGE || PINNED_HERMES_IMAGE,
      containerName: env.HERMES_CEO_CONTAINER || 'waypoint-hermes-ceo',
      volumeName: env.HERMES_CEO_VOLUME || 'waypoint-hermes-ceo-home',
      loginTimeoutSeconds: intFromEnv('HERMES_LOGIN_TIMEOUT_SECONDS', env.HERMES_LOGIN_TIMEOUT_SECONDS, 600, 5, 3600),
      autoStart: boolFromEnv('HERMES_AUTO_START', env.HERMES_AUTO_START, true),
      ceoTurnTimeoutMs: intFromEnv('HERMES_CEO_TURN_TIMEOUT_SECONDS', env.HERMES_CEO_TURN_TIMEOUT_SECONDS, 150, 5, 600) * 1000,
      ceoRunBudgetSeconds: intFromEnv('HERMES_CEO_RUN_BUDGET_SECONDS', env.HERMES_CEO_RUN_BUDGET_SECONDS, 120, 5, 600),
      ceoMaxTurns: intFromEnv('HERMES_CEO_MAX_TURNS', env.HERMES_CEO_MAX_TURNS, 50, 1, 500),
      ceoMaxMessageChars: intFromEnv('HERMES_CEO_MAX_MESSAGE_CHARS', env.HERMES_CEO_MAX_MESSAGE_CHARS, 4000, 1, 20000),
      ceoMaxMessages: intFromEnv('HERMES_CEO_MAX_MESSAGES', env.HERMES_CEO_MAX_MESSAGES, 100, 2, 500),
      ceoOutputLimitBytes: intFromEnv('HERMES_CEO_OUTPUT_LIMIT_BYTES', env.HERMES_CEO_OUTPUT_LIMIT_BYTES, 262144, 8192, 1048576),
    },
    // Host-only control API (named pipe / Unix socket). Never bound to TCP.
    control: resolveControlChannel(env),
    bridge: {
      token: env.WAYPOINT_BRIDGE_TOKEN || loadOrCreateBridgeToken(dataDir),
      baseUrl: env.WAYPOINT_BRIDGE_BASE_URL || `http://host.docker.internal:${port}/bridge/tools`,
    },
  };
}
export function publicConfig(config) {
  return {
    serviceName: config.serviceName,
    host: config.host,
    port: config.port,
    control: { transport: config.control.transport },
    dataDir: config.dataDir,
    dryRun: config.dryRun,
    sharedAuth: { enabled: config.sharedAuth.enabled },
    docker: { imageConfigured: Boolean(config.docker.image), imagePinned: Boolean(config.docker.image?.includes('@sha256:') || /^sha256:[0-9a-f]{64}$/.test(config.docker.image || '')), labelNamespace: config.docker.labelNamespace, namePrefix: config.docker.namePrefix, volumePrefix: config.docker.volumePrefix, containerDataDir: '/opt/data' },
    hermes: { imagePinned: config.hermes.image.includes('@sha256:') || /^sha256:[0-9a-f]{64}$/.test(config.hermes.image || ''), containerName: config.hermes.containerName, volumeName: config.hermes.volumeName, autoStart: config.hermes.autoStart, ceoMaxMessageChars: config.hermes.ceoMaxMessageChars, ceoMaxMessages: config.hermes.ceoMaxMessages },
  };
}
