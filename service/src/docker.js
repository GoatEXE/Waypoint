import { spawn } from 'node:child_process';
import path from 'node:path';
import { lifecycleError } from './errors.js';
import { ensureSharedAuthVolume, assertSharedAuthImage, sharedAuthMount } from './authVolume.js';

const SAFE_INSPECT_FORMAT = '{"id":"{{.Id}}","state":"{{.State.Status}}","running":{{.State.Running}}}';
const CONTAINER_DATA_DIR = '/opt/data';
const POD_NETWORK = 'bridge';
const POD_ID_RE = /^pod_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class DockerAdapter {
  constructor(config, logger = undefined, runner = defaultRunner) {
    this.config = config;
    this.logger = logger;
    this.runner = runner;
  }
  makeContainerName(podId) {
    assertPodId(podId);
    return `${this.config.docker.namePrefix}-${podId.replaceAll('_', '-')}`;
  }
  makeVolumeName(podId) {
    assertPodId(podId);
    return `${this.config.docker.volumePrefix}-${podId.replaceAll('_', '-')}`;
  }
  makeLabels(podId, podName = '') {
    assertPodId(podId);
    const labels = {
      [`${this.config.docker.labelNamespace}.owned`]: 'true',
      [`${this.config.docker.labelNamespace}.pod_id`]: podId,
    };
    if (podName) labels[`${this.config.docker.labelNamespace}.pod_name`] = String(podName);
    return labels;
  }
  startPlan({ podId, podName = '' }) {
    const labels = this.makeLabels(podId, podName);
    const containerName = this.makeContainerName(podId);
    const volumeName = this.makeVolumeName(podId);
    const mount = `type=volume,source=${volumeName},target=${CONTAINER_DATA_DIR}`;
    const args = ['run', '-d', '--name', containerName, '--network', POD_NETWORK, '--mount', mount];
    const authMount = sharedAuthMount(this.config);
    if (authMount) args.push('--mount', authMount);
    for (const [key, value] of Object.entries(labels)) args.push('--label', `${key}=${value}`);
    args.push(this.config.docker.image, ...this.config.docker.idleCommand);
    return {
      dryRunDefault: this.config.dryRun,
      command: 'docker',
      args,
      preflight: [
        { command: 'docker', args: ['volume', 'inspect', volumeName], purpose: 'verify any existing pod volume has matching Waypoint ownership labels' },
        { command: 'docker', args: ['volume', 'create', ...labelArgs(labels), volumeName], purpose: 'create the Waypoint-owned named volume if it is missing' },
        ...(authMount ? [{ command: 'docker', args: ['volume', 'inspect', this.config.sharedAuth.volumeName], purpose: 'verify the shared provider auth volume' }] : []),
      ],
      seed: {
        source: 'derived service data directory profiles/<seatId>, copied with docker cp after the idle container starts if the volume has no Waypoint seed marker',
        marker: `${CONTAINER_DATA_DIR}/.waypoint-volume-seeded`,
      },
      labels,
      image: this.config.docker.image,
      imagePinned: isPinnedImage(this.config.docker.image),
      containerName,
      volumeName,
      mount,
      containerDataDir: CONTAINER_DATA_DIR,
      startup: { mode: 'idle', argv: this.config.docker.idleCommand },
      network: { mode: POD_NETWORK, outbound: true, publishedPorts: false },
      security: { hostBindMount: false, dockerSocketMounted: false, bridgeTokenInjected: false, network: POD_NETWORK, sharedProviderAuth: Boolean(authMount) },
      notes: [
        'Container lifecycle plan only; no per-seat Hermes gateway launch script is generated and no model call is made.',
        authMount ? 'A Waypoint-owned pod volume is mounted to /opt/data, and a separately labeled shared provider-auth volume is mounted to /opt/waypoint-auth.' : 'A Waypoint-owned named Docker volume is mounted to /opt/data.',
        'Pod containers never receive a host bind mount, docker.sock, or Waypoint bridge token.',
        'Pods use Docker bridge networking for outbound provider/model/Bitwarden access; no ports are published by this plan.',
        'Before any live reuse, an existing labeled container must match the pinned image, expected volume mount, bridge-only networking, unprivileged host config, no port bindings, and no added capabilities; unsafe existing containers are refused rather than silently reused and may require manual removal/recreation.',
        'If the volume is not seeded, Waypoint copies derived profiles into /opt/data/profiles, runs chown -R hermes:hermes on /opt/data/profiles only, then writes the seed marker.',
        'One idle container is planned per pod. Seat profiles and workspaces remain data inside the pod volume, not host bind targets.',
      ],
    };
  }
  async lifecycle(instance, action) {
    if (!['start', 'stop', 'status'].includes(action)) throw lifecycleError('unsupported lifecycle action', { action });
    const podId = assertPodId(instance.id);
    const containerName = this.makeContainerName(podId);
    const volumeName = this.makeVolumeName(podId);
    const plan = action === 'start'
      ? this.startPlan({ podId, podName: instance.podName })
      : action === 'stop'
        ? { command: 'docker', args: ['stop', containerName], containerName, volumeName }
        : this.inspectPlan(containerName);
    if (this.config.dryRun) return { action, executed: false, dryRun: true, plan, message: 'Dry-run only; no container state changed and no Hermes task executed.' };

    if (action === 'status') {
      const inspected = await this.inspectOwnedContainer(containerName, podId, { allowMissing: true });
      return { action, executed: true, dryRun: false, containerName, volumeName, status: inspected.exists ? inspected.state : { state: 'missing', running: false } };
    }

    if (action === 'stop') {
      const inspected = await this.inspectOwnedContainer(containerName, podId, { allowMissing: true });
      if (!inspected.exists) return { action, executed: false, dryRun: false, containerName, volumeName, status: { state: 'missing', running: false } };
      if (!inspected.state.running) return { action, executed: false, dryRun: false, containerName, volumeName, status: inspected.state };
      const result = await this.runDocker(action, ['stop', containerName], containerName);
      const after = await this.inspectOwnedContainer(containerName, podId);
      return { ...result, volumeName, status: after.state };
    }

    if (!this.config.docker.image) throw lifecycleError('POD_DOCKER_IMAGE must be configured before live start');
    if (!isPinnedImage(this.config.docker.image)) throw lifecycleError('POD_DOCKER_IMAGE must be pinned by digest before live start');
    await assertSharedAuthImage(this.config, this.runner, this.config.docker.image);
    await assertSharedAuthImage(this.config, this.runner, this.config.hermes.image);
    await ensureSharedAuthVolume(this.config, this.runner);
    await this.ensureOwnedVolume(volumeName, podId, instance.podName);
    const inspected = await this.inspectOwnedContainer(containerName, podId, { allowMissing: true });
    if (inspected.exists) {
      assertExistingContainerSafeForStart(inspected.state, { containerName, volumeName, image: this.config.docker.image, sharedAuth: this.config.sharedAuth });
      if (inspected.state.running) {
        const seed = await this.ensureVolumeSeeded(podId, containerName);
        return { action, executed: false, dryRun: false, containerName, volumeName, status: inspected.state, seed };
      }
      const result = await this.runDocker(action, ['start', containerName], containerName);
      const seed = await this.ensureVolumeSeeded(podId, containerName);
      const after = await this.inspectOwnedContainer(containerName, podId);
      return { ...result, volumeName, seed, status: after.state };
    }
    const result = await this.runDocker(action, plan.args, containerName);
    const seed = await this.ensureVolumeSeeded(podId, containerName);
    const after = await this.inspectOwnedContainer(containerName, podId);
    return { ...result, volumeName, seed, status: after.state };
  }
  inspectPlan(containerName) {
    return { command: 'docker', args: ['inspect', '--format', SAFE_INSPECT_FORMAT, containerName], redacted: true };
  }
  async ensureOwnedVolume(volumeName, podId, podName = '') {
    const inspected = await this.inspectOwnedVolume(volumeName, podId, { allowMissing: true });
    if (inspected.exists) return inspected;
    const result = await this.runner('docker', ['volume', 'create', ...labelArgs(this.makeLabels(podId, podName)), volumeName]);
    if (result.code !== 0) throw lifecycleError('pod volume could not be created', { volumeName, code: result.code });
    return this.inspectOwnedVolume(volumeName, podId, { allowMissing: false });
  }
  async ensureVolumeSeeded(podId, containerName) {
    const marker = `${CONTAINER_DATA_DIR}/.waypoint-volume-seeded`;
    const seeded = await this.runner('docker', ['exec', containerName, 'sh', '-lc', `test -e ${shellQuote(marker)}`]);
    if (seeded.code === 0) return { changed: false, marker };
    const mkdir = await this.runner('docker', ['exec', containerName, 'sh', '-lc', `mkdir -p ${shellQuote(`${CONTAINER_DATA_DIR}/profiles`)}`]);
    if (mkdir.code !== 0) throw lifecycleError('pod volume seed directory could not be prepared', { containerName, code: mkdir.code });
    const profilesSource = path.join(this.config.dataDir, 'instances', podId, 'profiles');
    const source = `${profilesSource}${path.sep}.`;
    const copy = await this.runner('docker', ['cp', source, `${containerName}:${CONTAINER_DATA_DIR}/profiles`]);
    if (copy.code !== 0) throw lifecycleError('pod volume could not be seeded from derived host profile path', { containerName, code: copy.code });
    const chown = await this.runner('docker', ['exec', '--user', 'root', containerName, 'chown', '-R', 'hermes:hermes', `${CONTAINER_DATA_DIR}/profiles`]);
    if (chown.code !== 0) throw lifecycleError('pod volume seed ownership could not be assigned to the Hermes user', { containerName, code: chown.code });
    const touch = await this.runner('docker', ['exec', containerName, 'sh', '-lc', `touch ${shellQuote(marker)}`]);
    if (touch.code !== 0) throw lifecycleError('pod volume seed marker could not be written', { containerName, code: touch.code });
    return { changed: true, marker };
  }
  async inspectOwnedContainer(containerName, podId, { allowMissing = false } = {}) {
    const podIdLabel = `${this.config.docker.labelNamespace}.pod_id`;
    const ownedLabel = `${this.config.docker.labelNamespace}.owned`;
    const format = `{"owned":"{{ index .Config.Labels \"${ownedLabel}\" }}","podId":"{{ index .Config.Labels \"${podIdLabel}\" }}","id":"{{.Id}}","state":"{{.State.Status}}","running":{{.State.Running}},"image":"{{.Config.Image}}","mounts":{{json .Mounts}},"privileged":{{json .HostConfig.Privileged}},"portBindings":{{json .HostConfig.PortBindings}},"capAdd":{{json .HostConfig.CapAdd}},"networkMode":"{{.HostConfig.NetworkMode}}","networks":{{json .NetworkSettings.Networks}}}`;
    const result = await this.runner('docker', ['inspect', '--format', format, containerName]);
    if (result.code !== 0) {
      if (allowMissing && isNoSuchContainer(result.stderr)) return { exists: false };
      throw lifecycleError('container cannot be inspected as Waypoint-owned', { containerName, code: result.code });
    }
    let parsed;
    try { parsed = JSON.parse(result.stdout.trim()); }
    catch { throw lifecycleError('docker inspect returned an unexpected shape', { containerName }); }
    if (parsed.owned !== 'true' || parsed.podId !== podId) throw lifecycleError('refusing to operate on container without matching Waypoint ownership labels', { containerName });
    return { exists: true, state: {
      id: parsed.id,
      state: parsed.state,
      running: Boolean(parsed.running),
      image: String(parsed.image || ''),
      mounts: Array.isArray(parsed.mounts) ? parsed.mounts : null,
      privileged: parsed.privileged,
      portBindings: isPlainObject(parsed.portBindings) ? parsed.portBindings : null,
      capAdd: parsed.capAdd,
      networkMode: String(parsed.networkMode || ''),
      networks: normalizeNetworkNames(parsed.networks),
    } };
  }
  async inspectOwnedVolume(volumeName, podId, { allowMissing = false } = {}) {
    const podIdLabel = `${this.config.docker.labelNamespace}.pod_id`;
    const ownedLabel = `${this.config.docker.labelNamespace}.owned`;
    const format = `{"owned":"{{ index .Labels \"${ownedLabel}\" }}","podId":"{{ index .Labels \"${podIdLabel}\" }}","name":"{{.Name}}","driver":"{{.Driver}}","options":{{json .Options}}}`;
    const result = await this.runner('docker', ['volume', 'inspect', '--format', format, volumeName]);
    if (result.code !== 0) {
      if (allowMissing && isNoSuchVolume(result.stderr)) return { exists: false };
      throw lifecycleError('pod volume cannot be inspected as Waypoint-owned', { volumeName, code: result.code });
    }
    let parsed;
    try { parsed = JSON.parse(result.stdout.trim()); }
    catch { throw lifecycleError('docker volume inspect returned an unexpected shape', { volumeName }); }
    if (parsed.owned !== 'true' || parsed.podId !== podId) throw lifecycleError('refusing to use volume without matching Waypoint ownership labels', { volumeName });
    if (parsed.name !== volumeName) throw lifecycleError('refusing to use volume whose inspected name does not match the expected pod volume', { volumeName });
    if (!isSafeDockerVolume(parsed)) throw lifecycleError('refusing to use unsafe pod volume driver or options', { volumeName, driver: parsed.driver || '' });
    return { exists: true, state: { name: parsed.name, driver: parsed.driver, options: parsed.options || {} } };
  }
  async runDocker(action, args, containerName) {
    const result = await this.runner('docker', args);
    if (result.code !== 0) throw lifecycleError('docker command failed', { action, code: result.code });
    return { action, executed: true, dryRun: false, containerName, result: action === 'status' ? undefined : 'ok' };
  }
}

function labelArgs(labels) {
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}
function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
function normalizeNetworkNames(networks) {
  if (!isPlainObject(networks)) return null;
  return Object.keys(networks).filter((name) => typeof name === 'string').sort();
}
function assertExistingContainerSafeForStart(state, { containerName, volumeName, image, sharedAuth }) {
  if (!imageMatchesConfigured(state.image, image)) throw lifecycleError('refusing to reuse existing pod container with unexpected image', { containerName });
  const expectAuth = sharedAuth?.enabled === true;
  if (!Array.isArray(state.mounts) || state.mounts.length !== (expectAuth ? 2 : 1)) throw lifecycleError('refusing to reuse existing pod container with unexpected mounts', { containerName });
  const mount = state.mounts.find((entry) => entry.Destination === CONTAINER_DATA_DIR);
  if (!mount || mount.Type !== 'volume' || mount.Name !== volumeName || mount.Destination !== CONTAINER_DATA_DIR) throw lifecycleError('refusing to reuse existing pod container with unsafe /opt/data mount', { containerName });
  if (expectAuth) {
    const auth = state.mounts.find((entry) => entry.Destination === sharedAuth.mountPath);
    if (!auth || auth.Type !== 'volume' || auth.Name !== sharedAuth.volumeName || auth.RW !== true) throw lifecycleError('refusing to reuse pod container without the expected shared provider volume', { containerName });
  }
  if (state.privileged !== false) throw lifecycleError('refusing to reuse privileged pod container', { containerName });
  if (state.portBindings == null || Object.keys(state.portBindings).length !== 0) throw lifecycleError('refusing to reuse pod container with published ports', { containerName });
  if (state.capAdd != null && (!Array.isArray(state.capAdd) || state.capAdd.length !== 0)) throw lifecycleError('refusing to reuse pod container with added capabilities', { containerName });
  if (state.networkMode !== POD_NETWORK) throw lifecycleError('refusing to reuse pod container with incompatible Docker network mode', { containerName, networkMode: state.networkMode });
  if (!Array.isArray(state.networks) || state.networks.length !== 1 || state.networks[0] !== POD_NETWORK) throw lifecycleError('refusing to reuse pod container with incompatible Docker networks', { containerName });
}
function imageMatchesConfigured(actual, expected) {
  const a = String(actual || '');
  const e = String(expected || '');
  if (!a || !e) return false;
  if (a === e) return true;
  return e.includes('@sha256:') && a.endsWith(`/${e}`);
}
function isPinnedImage(image) {
  return Boolean(image?.includes('@sha256:') || /^sha256:[0-9a-f]{64}$/.test(image || ''));
}
function isSafeDockerVolume(parsed) {
  if (parsed.driver !== 'local') return false;
  if (parsed.options == null) return true;
  return isPlainObject(parsed.options) && Object.keys(parsed.options).length === 0;
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function assertPodId(podId) {
  const value = String(podId || '');
  if (!POD_ID_RE.test(value)) throw lifecycleError('invalid pod id for Docker lifecycle');
  return value;
}
function isNoSuchContainer(stderr = '') {
  return /No such object|No such container/i.test(stderr);
}
function isNoSuchVolume(stderr = '') {
  return /No such volume|No such object/i.test(stderr);
}

function defaultRunner(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: String(error.message || error) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
