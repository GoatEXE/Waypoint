import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import { assertSharedAuthImage, ensureSharedAuthVolume, sharedAuthMount } from '../src/authVolume.js';

const config = loadConfig(process.env, process.cwd());
if (!config.sharedAuth.enabled) throw new Error('WAYPOINT_SHARED_AUTH must be true');
const image = config.hermes.image;
const maxBytes = 1024 * 1024;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { input: options.input, timeout: 30000, maxBuffer: maxBytes + 4096, windowsHide: true });
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

await assertSharedAuthImage(config, async (_command, args) => {
  const result = docker(args);
  return { code: result.code, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}, image);
await ensureSharedAuthVolume(config, async (_command, args) => {
  const result = docker(args);
  return { code: result.code, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
});

const owned = docker(['inspect', '--format', '{{ index .Config.Labels "com.waypoint.hermes.owned" }}', config.hermes.containerName]);
if (owned.code !== 0 || owned.stdout.toString().trim() !== 'true') throw new Error('CEO container is not Waypoint-owned and available');

const source = docker(['exec', '--user', 'hermes', config.hermes.containerName, 'python3', '-c', String.raw`
import json, os, stat, sys
from hermes_cli import auth
p='/opt/data/auth.json'
st=os.lstat(p)
if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or st.st_size>1048576 or (stat.S_IMODE(st.st_mode)&0o077): sys.exit(2)
with auth._auth_store_lock():
 with open(p,'rb') as f: sys.stdout.buffer.write(f.read(1048577))
`]);
if (source.code !== 0 || !source.stdout.length || source.stdout.length > maxBytes) throw new Error('CEO auth store could not be read safely');

try {
  const target = docker(['run', '--rm', '-i', '--network', 'none', '--user', 'hermes', '--mount', sharedAuthMount(config), '--entrypoint', 'python3', image, '-c', String.raw`
import json, os, stat, sys, tempfile
root='/opt/waypoint-auth'; target=root+'/auth.json'
st=os.lstat(root)
if not stat.S_ISDIR(st.st_mode) or st.st_uid!=os.getuid(): sys.exit(2)
if os.path.lexists(target): sys.exit(3)
raw=sys.stdin.buffer.read(1048577)
data=json.loads(raw)
if not isinstance(data,dict) or not isinstance(data.get('providers'),dict): sys.exit(2)
fd,tmp=tempfile.mkstemp(prefix='.waypoint-migrate-',dir=root)
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,'wb') as f: f.write(raw); f.flush(); os.fsync(f.fileno())
 os.replace(tmp,target)
finally:
 if os.path.exists(tmp): os.unlink(tmp)
print('migrated')
`], { input: source.stdout });
  if (target.code !== 0 || target.stdout.toString().trim() !== 'migrated') throw new Error('shared auth migration failed or the target already exists');
  console.log('Shared Hermes auth store prepared. The CEO and pods can now be recreated with the shared auth image.');
} finally {
  source.stdout.fill(0);
}
