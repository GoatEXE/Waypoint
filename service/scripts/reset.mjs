import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { loadConfig } from '../src/config.js';

const config = loadConfig({ ...process.env, WAYPOINT_BRIDGE_TOKEN: 'reset-placeholder-token' }, process.cwd());
const confirmed = process.argv.includes('--yes');

function docker(args) {
  try { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
  catch { return []; }
}

function serviceRunning() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: config.port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

const podLabel = `label=${config.docker.labelNamespace}.owned=true`;
const containers = [...new Set([...docker(['ps', '-a', '--filter', `name=^${config.hermes.containerName}$`, '--format', '{{.Names}}']), ...docker(['ps', '-a', '--filter', podLabel, '--format', '{{.Names}}'])])];
const volumes = [...new Set([
  ...docker(['volume', 'ls', '-q', '--filter', `name=^${config.hermes.volumeName}$`]),
  ...docker(['volume', 'ls', '-q', '--filter', `name=^${config.sharedAuth.volumeName}$`]),
  ...docker(['volume', 'ls', '-q', '--filter', `name=^${config.docker.volumePrefix}-`]),
])];
const dataExists = fs.existsSync(config.dataDir);

console.log('Waypoint reset');
console.log(`  containers: ${containers.join(', ') || 'none'}`);
console.log(`  volumes:    ${volumes.join(', ') || 'none'}`);
console.log(`  data:       ${dataExists ? config.dataDir : 'none'}`);

if (!confirmed) {
  console.log('\nNothing was deleted. Run again with --yes to delete everything listed.');
  process.exit(0);
}
if (await serviceRunning()) {
  console.error(`\nThe Waypoint service is running on port ${config.port}. Stop it first, then run the reset again.`);
  process.exit(1);
}
if (containers.length) execFileSync('docker', ['rm', '-f', ...containers], { stdio: 'ignore' });
if (volumes.length) execFileSync('docker', ['volume', 'rm', '-f', ...volumes], { stdio: 'ignore' });
if (dataExists) fs.rmSync(config.dataDir, { recursive: true, force: true });
console.log('\nReset complete. Start the service and reload the app to run first-time setup.');
