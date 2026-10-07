

import { spawn } from 'node:child_process';
import { resolveControlChannel } from '../../service/src/controlChannel.js';
import { BOOTSTRAP_PATH, createSessionStore, normalizeFingerprint } from '../server/controlProxy.js';

const store = createSessionStore(resolveControlChannel(process.env).dir);
const approveIndex = process.argv.indexOf('--approve');

if (approveIndex !== -1) {
  const fingerprint = normalizeFingerprint(process.argv[approveIndex + 1]);
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(fingerprint)) {
    console.error('Usage: npm run approve -- XXXX-XXXX (the fingerprint shown at /__waypoint/pair)');
    process.exit(1);
  }
  if (!store.approvePairing(fingerprint)) {
    console.error(`No pending pairing with fingerprint ${fingerprint}. Reload /__waypoint/pair in the browser and use the new fingerprint.`);
    process.exit(1);
  }
  console.log(`Approved ${fingerprint}. The browser will finish signing in within a few seconds.`);
  process.exit(0);
}

const base = (process.env.WAYPOINT_APP_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '');
try {
  await fetch(base, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`Waypoint app is not reachable at ${base}. Start it first: npm run dev`);
  process.exit(1);
}

const url = `${base}${BOOTSTRAP_PATH}?code=${store.issueBootstrapCode()}`;
if (process.argv.includes('--print')) {
  console.log(url);
} else {
  const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {
    console.error(`Could not launch a browser. Open ${base}/__waypoint/pair in your browser and run npm run approve -- <fingerprint>.`);
    process.exitCode = 1;
  }).unref();
  console.log(`Opening Waypoint at ${base} with a one-time sign-in link (valid 2 minutes).`);
}
