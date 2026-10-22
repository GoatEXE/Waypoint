import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveControlChannel } from './controlChannel.js';

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
  try { fs.chmodSync(tokenPath, 0o600); } catch {   }
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
    hermes: {
      home: path.resolve(cwd, env.WAYPOINT_HERMES_HOME || path.join(dataDir, 'hermes-home')),
      bin: env.HERMES_BIN || 'hermes',
      python: env.HERMES_PYTHON || '',
      loginTimeoutSeconds: intFromEnv('HERMES_LOGIN_TIMEOUT_SECONDS', env.HERMES_LOGIN_TIMEOUT_SECONDS, 600, 5, 3600),
      autoStart: boolFromEnv('HERMES_AUTO_START', env.HERMES_AUTO_START, true),
      ceoTurnTimeoutMs: intFromEnv('HERMES_CEO_TURN_TIMEOUT_SECONDS', env.HERMES_CEO_TURN_TIMEOUT_SECONDS, 150, 5, 600) * 1000,
      ceoRunBudgetSeconds: intFromEnv('HERMES_CEO_RUN_BUDGET_SECONDS', env.HERMES_CEO_RUN_BUDGET_SECONDS, 120, 5, 600),
      ceoMaxTurns: intFromEnv('HERMES_CEO_MAX_TURNS', env.HERMES_CEO_MAX_TURNS, 50, 1, 500),
      ceoMaxMessageChars: intFromEnv('HERMES_CEO_MAX_MESSAGE_CHARS', env.HERMES_CEO_MAX_MESSAGE_CHARS, 4000, 1, 20000),
      ceoMaxMessages: intFromEnv('HERMES_CEO_MAX_MESSAGES', env.HERMES_CEO_MAX_MESSAGES, 100, 2, 500),
      ceoOutputLimitBytes: intFromEnv('HERMES_CEO_OUTPUT_LIMIT_BYTES', env.HERMES_CEO_OUTPUT_LIMIT_BYTES, 262144, 8192, 1048576),
      portalPort: intFromEnv('HERMES_PORTAL_PORT', env.HERMES_PORTAL_PORT, 3081, 1, 65535),
      portalIdleMs: intFromEnv('HERMES_PORTAL_IDLE_MINUTES', env.HERMES_PORTAL_IDLE_MINUTES, 30, 1, 1440) * 60000,
    },

    control: resolveControlChannel(env),
    bridge: {
      token: env.WAYPOINT_BRIDGE_TOKEN || loadOrCreateBridgeToken(dataDir),
      baseUrl: env.WAYPOINT_BRIDGE_BASE_URL || `http://127.0.0.1:${port}/bridge/tools`,
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
    hermes: { home: config.hermes.home, autoStart: config.hermes.autoStart, ceoMaxMessageChars: config.hermes.ceoMaxMessageChars, ceoMaxMessages: config.hermes.ceoMaxMessages },
  };
}
