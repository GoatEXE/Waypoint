import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';

const FIELDS = ['name', 'about'];
export const USER_NAME_MAX = 60;
export const USER_ABOUT_MAX = 280;

function cleanName(value) {
  if (typeof value !== 'string') throw badRequest('name must be text');
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > USER_NAME_MAX || /[\x00-\x1f\x7f]/.test(text)) throw badRequest(`name must be 1-${USER_NAME_MAX} visible characters`);
  return text;
}

function cleanAbout(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw badRequest('about must be text');
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > USER_ABOUT_MAX || /[\x00-\x1f\x7f]/.test(text)) throw badRequest(`about must be at most ${USER_ABOUT_MAX} visible characters`);
  return text;
}

export function userSeedEntries(user) {
  const entries = [`The user's name is ${user.name}.`];
  if (user.about) entries.push(`In their own words: ${user.about}`);
  return entries;
}

export class UserStore {
  constructor(dataDir) {
    this.filePath = path.join(dataDir, 'user.json');
    this.lock = Promise.resolve();
  }

  async get() {
    try { return JSON.parse(await fs.readFile(this.filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async describe() {
    const user = await this.get();
    return { configured: Boolean(user), user: user ? publicUser(user) : null };
  }

  update(input) { return this.#locked(() => this.#applyUpdate(input)); }

  markSeeded(seed) { return this.#locked(async () => { const user = await this.get(); if (user) await this.#write({ ...user, seed }); return user ? publicUser({ ...user, seed }) : null; }); }

  #locked(fn) {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => {});
    return run;
  }

  async #applyUpdate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('body must be an object');
    const extra = Object.keys(input).filter((key) => !FIELDS.includes(key));
    if (extra.length) throw badRequest('unsupported user fields', { fields: extra.slice(0, 10).map((key) => key.slice(0, 64)) });
    const current = await this.get();
    if (!current && input.name === undefined) throw badRequest('name is required');
    const now = new Date().toISOString();
    const next = {
      name: input.name === undefined ? current.name : cleanName(input.name),
      about: input.about === undefined ? current?.about || '' : cleanAbout(input.about),
      seed: current?.seed?.state === 'done' ? current.seed : { state: 'pending' },
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    await this.#write(next);
    return publicUser(next);
  }

  async #write(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, this.filePath);
  }
}

function publicUser(user) {
  return { name: user.name, about: user.about || '', seed: user.seed || { state: 'pending' }, createdAt: user.createdAt, updatedAt: user.updatedAt };
}

export async function seedCeoUserProfile(hermes, users, logger = undefined) {
  const user = await users.get();
  if (!user || (user.seed && user.seed.state !== 'pending')) return user ? publicUser(user) : null;
  try {
    const result = await hermes.execPython(SEED_USER_SCRIPT, JSON.stringify({ entries: userSeedEntries(user) }), { timeoutMs: 30000 });
    const parsed = JSON.parse(String(result.stdout || '').trim().split('\n').pop() || '{}');
    const seed = parsed.ok ? { state: 'done', at: new Date().toISOString() } : { state: 'failed', error: String(parsed.error || 'USER.md could not be updated.').slice(0, 300) };
    return users.markSeeded(seed);
  } catch (error) {
    logger?.warn('user_seed_failed', { message: error.message });
    return publicUser(user);
  }
}

export const SEED_USER_SCRIPT = String.raw`
import json, sys
p = json.loads(sys.stdin.read() or '{}')
from tools.memory_tool import load_on_disk_store
store = load_on_disk_store()
ops = [{'action': 'add', 'content': entry} for entry in p.get('entries', [])]
result = store.apply_batch('user', ops)
if result.get('success'):
    print(json.dumps({'ok': True}))
else:
    print(json.dumps({'ok': False, 'error': str(result.get('error') or '')[:300]}))
`;
