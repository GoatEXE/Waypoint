import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { loadConfig } from '../src/config.js';
import { NativeHost } from '../src/hermesHost.js';

const config = loadConfig({ ...process.env, WAYPOINT_BRIDGE_TOKEN: 'reset-placeholder-token' }, process.cwd());
const confirmed = process.argv.includes('--yes');

function serviceRunning() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: config.port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

const dataExists = fs.existsSync(config.dataDir);
const homeExists = fs.existsSync(config.hermes.home);

console.log('Waypoint reset');
console.log(`  data:   ${dataExists ? config.dataDir : 'none'}`);
console.log(`  hermes: ${homeExists ? config.hermes.home : 'none'}`);

if (!confirmed) {
  console.log('\nNothing was deleted. Run again with --yes to delete everything listed.');
  process.exit(0);
}
if (await serviceRunning()) {
  console.error(`\nThe Waypoint service is running on port ${config.port}. Stop it first, then run the reset again.`);
  process.exit(1);
}
if (homeExists) {
  const stop = new NativeHost(config).hermes(['gateway', 'stop']);
  try { execFileSync(stop.command, stop.args, { ...stop.options, stdio: 'ignore', timeout: 60000 }); } catch {   }
  fs.rmSync(config.hermes.home, { recursive: true, force: true });
}
if (dataExists) fs.rmSync(config.dataDir, { recursive: true, force: true });
console.log('\nReset complete. Start the service and reload the app to run first-time setup.');
