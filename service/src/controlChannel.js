import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Host-only control channel shared by the service (listener) and the app dev proxy (client).
// Windows uses a named pipe; macOS/Linux use a Unix socket inside a 0700 directory.
// Containers cannot reach either, unlike loopback TCP on Docker Desktop.
const DEFAULT_CONTROL_DIR = fileURLToPath(new URL('../runtime/control', import.meta.url));
const MAX_UNIX_SOCKET_PATH = 100;

export function resolveControlChannel(env = process.env, platform = process.platform) {
  const dir = path.resolve(env.WAYPOINT_CONTROL_DIR || DEFAULT_CONTROL_DIR);
  const transport = platform === 'win32' ? 'named-pipe' : 'unix-socket';
  let socketPath = env.WAYPOINT_CONTROL_SOCKET || '';
  if (!socketPath) {
    socketPath = transport === 'named-pipe'
      ? `\\\\.\\pipe\\waypoint-control-${createHash('sha256').update(dir.toLowerCase()).digest('hex').slice(0, 16)}`
      : path.join(dir, 'control.sock');
  }
  if (transport === 'unix-socket' && Buffer.byteLength(socketPath) > MAX_UNIX_SOCKET_PATH) {
    throw new Error(`Control socket path is too long for a Unix socket (${socketPath}); set WAYPOINT_CONTROL_DIR or WAYPOINT_CONTROL_SOCKET to a shorter path`);
  }
  return { dir, socketPath, transport };
}

export function ensureControlDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows ignores POSIX modes; the dir inherits the user profile ACL */ }
}

export async function listenControl(server, channel) {
  ensureControlDir(channel.dir);
  if (channel.transport === 'unix-socket') removeStaleSocket(channel.socketPath);
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ path: channel.socketPath, readableAll: false, writableAll: false });
  });
  if (channel.transport === 'unix-socket') fs.chmodSync(channel.socketPath, 0o600);
}

function removeStaleSocket(socketPath) {
  let stat;
  try { stat = fs.lstatSync(socketPath); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket file at control socket path ${socketPath}`);
  fs.unlinkSync(socketPath);
}
