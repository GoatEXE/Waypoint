import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { badRequest } from './errors.js';

export const PROJECT_MOUNT_ROOT = '/opt/data/projects';
const PROJECT_TARGET_RE = /^\/opt\/data\/projects\/project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function projectMountTarget(projectId) {
  return `${PROJECT_MOUNT_ROOT}/${projectId}`;
}

export function isProjectBindMount(entry) {
  return entry?.Type === 'bind' && PROJECT_TARGET_RE.test(String(entry.Destination || ''));
}

export function mountsKey(mounts = []) {
  const normalized = mounts.map((m) => `${path.resolve(m.source).toLowerCase()}=>${m.target}`).sort();
  return normalized.length ? createHash('sha256').update(normalized.join('\n')).digest('hex').slice(0, 32) : '';
}

export async function assertProjectFolder(localPath) {
  const dir = String(localPath || '').trim();
  if (!dir || dir.length > 1000 || !path.isAbsolute(dir)) throw badRequest('localPath must be an absolute folder path');
  const resolved = path.resolve(dir);
  if (path.parse(resolved).root === resolved || resolved.toLowerCase() === path.resolve(os.homedir()).toLowerCase()) throw badRequest('choose a project folder, not a drive or home folder');
  if (!(await fs.stat(resolved).catch(() => null))?.isDirectory()) throw badRequest('localPath folder does not exist');
  return resolved;
}

export function podProjectMounts(projects, podId) {
  return projects
    .filter((project) => project.workspace === 'local' && project.localPath && (project.githubSeats || []).some((address) => address.startsWith(`${podId}/`)))
    .map((project) => ({ projectId: project.id, source: project.localPath, target: projectMountTarget(project.id) }));
}

function hostGit(dir, key) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'config', '--get', key], { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? '' : String(stdout).trim()));
  });
}

export async function localProjectGitEnv(project, seatId) {
  const autocrlf = await hostGit(project.localPath, 'core.autocrlf');
  const workdir = projectMountTarget(project.id);
  const entries = [
    ['safe.directory', workdir],
    ['core.autocrlf', ['true', 'input', 'false'].includes(autocrlf) ? autocrlf : 'false'],
    ['credential.helper', ''],
    ['credential.helper', '!/usr/local/bin/waypoint-git-credential'],
    ['credential.useHttpPath', 'true'],
    ['user.name', `${seatId} (Waypoint)`],
    ['user.email', `${seatId}@waypoint.local`],
  ];
  return [`GIT_CONFIG_COUNT=${entries.length}`, ...entries.flatMap(([key, value], index) => [`GIT_CONFIG_KEY_${index}=${key}`, `GIT_CONFIG_VALUE_${index}=${value}`])];
}
