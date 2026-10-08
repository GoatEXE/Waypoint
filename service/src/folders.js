import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { badRequest, notFound } from './errors.js';

const MAX_ENTRIES = 500;

async function isDirectory(target) {
  return (await fs.stat(target).catch(() => null))?.isDirectory() || false;
}

async function roots() {
  const home = os.homedir();
  const list = [{ name: 'Home', path: home, isGit: await isDirectory(path.join(home, '.git')) }];
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${letter}:\\`;
      if (await isDirectory(drive)) list.push({ name: `${letter}:`, path: drive, isGit: false });
    }
  } else {
    list.push({ name: '/', path: '/', isGit: false });
  }
  return list;
}

export async function listFolders(input) {
  const raw = String(input || '').trim();
  if (!raw) return { path: null, parent: null, entries: await roots() };
  if (raw.length > 1000 || !path.isAbsolute(raw)) throw badRequest('path must be an absolute folder path');
  const dir = path.resolve(raw);
  let items;
  try { items = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw notFound('folder not found');
    if (error.code === 'EACCES' || error.code === 'EPERM') throw badRequest('folder cannot be read');
    throw error;
  }
  const folders = items.filter((item) => item.isDirectory() && !item.name.startsWith('.') && !item.name.startsWith('$')).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const entries = [];
  for (const item of folders.slice(0, MAX_ENTRIES)) {
    const full = path.join(dir, item.name);
    entries.push({ name: item.name, path: full, isGit: await isDirectory(path.join(full, '.git')) });
  }
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, isGit: await isDirectory(path.join(dir, '.git')), entries, truncated: folders.length > MAX_ENTRIES };
}
