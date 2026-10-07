import { lifecycleError } from './errors.js';

export const AUTH_VOLUME_LABEL = 'com.waypoint.shared-auth';

export async function ensureSharedAuthVolume(config, runner) {
  if (!config.sharedAuth?.enabled) return;
  const name = config.sharedAuth.volumeName;
  const inspect = async () => runner('docker', ['volume', 'inspect', '--format', `{"name":"{{.Name}}","driver":"{{.Driver}}","options":{{json .Options}},"owned":"{{ index .Labels "${AUTH_VOLUME_LABEL}" }}"}`, name]);
  let result = await inspect();
  let created = false;
  if (result.code !== 0) {
    if (!/No such volume|No such object/i.test(result.stderr || '')) throw lifecycleError('shared provider volume could not be inspected');
    const made = await runner('docker', ['volume', 'create', '--label', `${AUTH_VOLUME_LABEL}=true`, name]);
    if (made.code !== 0) throw lifecycleError('shared provider volume could not be created');
    created = true;
    result = await inspect();
  }
  let volume;
  try { volume = JSON.parse(result.stdout.trim()); }
  catch { throw lifecycleError('shared provider volume inspection returned an unexpected shape'); }
  if (result.code !== 0 || volume.name !== name || volume.owned !== 'true' || volume.driver !== 'local' || !safeOptions(volume.options)) {
    throw lifecycleError('refusing to use unsafe or unowned shared provider volume');
  }
  if (created) {
    const prepared = await runner('docker', ['run', '--rm', '--network', 'none', '--mount', `type=volume,source=${name},target=${config.sharedAuth.mountPath},volume-nocopy`, '--entrypoint', 'sh', config.hermes.image, '-c', `chown hermes:hermes ${config.sharedAuth.mountPath} && chmod 700 ${config.sharedAuth.mountPath}`]);
    if (prepared.code !== 0) throw lifecycleError('shared provider volume ownership could not be prepared');
  }
}

export async function verifySharedAuthVolume(config, runner) {
  if (!config.sharedAuth?.enabled) return;
  const name = config.sharedAuth.volumeName;
  const result = await runner('docker', ['volume', 'inspect', '--format', `{"name":"{{.Name}}","driver":"{{.Driver}}","options":{{json .Options}},"owned":"{{ index .Labels "${AUTH_VOLUME_LABEL}" }}"}`, name]);
  let volume;
  try { volume = JSON.parse(result.stdout.trim()); }
  catch { throw lifecycleError('shared provider volume inspection returned an unexpected shape'); }
  if (result.code !== 0 || volume.name !== name || volume.owned !== 'true' || volume.driver !== 'local' || !safeOptions(volume.options)) {
    throw lifecycleError('refusing to use unsafe or unowned shared provider volume');
  }
}

function safeOptions(options) {
  return options == null || (typeof options === 'object' && !Array.isArray(options) && Object.keys(options).length === 0);
}

export async function assertSharedAuthImage(config, runner, image) {
  if (!config.sharedAuth?.enabled) return;
  const result = await runner('docker', ['image', 'inspect', '--format', `{{ index .Config.Labels "${AUTH_VOLUME_LABEL}" }}`, image]);
  if (result.code !== 0 || result.stdout.trim() !== 'true') throw lifecycleError('shared provider auth requires the Waypoint Hermes image overlay');
}

export function sharedAuthMount(config) {
  if (!config.sharedAuth?.enabled) return null;
  return `type=volume,source=${config.sharedAuth.volumeName},target=${config.sharedAuth.mountPath},volume-nocopy`;
}
