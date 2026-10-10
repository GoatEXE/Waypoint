import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';

const FIELDS = ['name', 'key', 'ceoName', 'logo'];
const NAME_MAX = 80;
const CEO_NAME_MAX = 40;
const KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/;
const LOGO_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
export const LOGO_MAX_BYTES = 256 * 1024;

export function deriveOrgKey(name) {
  const letters = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^[0-9]+/, '');
  return letters.length >= 2 ? letters.slice(0, 3) : 'WP';
}

function visibleText(value, field, max) {
  if (typeof value !== 'string') throw badRequest(`${field} must be text`);
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > max || /[\x00-\x1f\x7f]/.test(text)) throw badRequest(`${field} must be 1-${max} visible characters`);
  return text;
}

function normalizeKey(value) {
  const key = String(value || '').trim().toUpperCase();
  if (!KEY_RE.test(key)) throw badRequest('key must be 2-6 letters or digits, starting with a letter');
  return key;
}

function normalizeLogo(value) {
  if (value === null) return null;
  const match = typeof value === 'string' ? value.match(LOGO_RE) : null;
  if (!match) throw badRequest('logo must be a base64 PNG, JPEG, WebP, or GIF data URL');
  if (Buffer.from(match[2], 'base64').length > LOGO_MAX_BYTES) throw badRequest(`logo must be at most ${LOGO_MAX_BYTES / 1024} KB`);
  return value;
}

export class OrganizationStore {
  constructor(dataDir) {
    this.filePath = path.join(dataDir, 'organization.json');
    this.lock = Promise.resolve();
  }

  async get() {
    try { return JSON.parse(await fs.readFile(this.filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async describe() {
    const organization = await this.get();
    return { configured: Boolean(organization), organization };
  }

  update(input) {
    const run = this.lock.then(() => this.applyUpdate(input));
    this.lock = run.catch(() => {});
    return run;
  }

  async applyUpdate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('body must be an object');
    const extra = Object.keys(input).filter((key) => !FIELDS.includes(key));
    if (extra.length) throw badRequest('unsupported organization fields', { fields: extra.slice(0, 10).map((key) => key.slice(0, 64)) });
    const current = await this.get();
    if (!current && input.name === undefined) throw badRequest('name is required to create the organization');
    const now = new Date().toISOString();
    const name = input.name === undefined ? current.name : visibleText(input.name, 'name', NAME_MAX);
    const next = {
      name,
      key: input.key !== undefined ? normalizeKey(input.key) : current?.key || deriveOrgKey(name),
      ceoName: input.ceoName !== undefined ? visibleText(input.ceoName, 'ceoName', CEO_NAME_MAX) : current?.ceoName || 'CEO',
      logo: input.logo !== undefined ? normalizeLogo(input.logo) : current?.logo ?? null,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2));
    await fs.rename(tmp, this.filePath);
    return { organization: next, identityChanged: !current || current.name !== next.name || current.ceoName !== next.ceoName };
  }
}
