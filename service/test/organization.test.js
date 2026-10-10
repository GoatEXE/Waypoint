import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { LOGO_MAX_BYTES, OrganizationStore, deriveOrgKey } from '../src/organization.js';

const tinyPng = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;

async function tempStore() {
  return new OrganizationStore(await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-org-')));
}

test('deriveOrgKey uses the first letters of the name', () => {
  assert.equal(deriveOrgKey('Ortho Arkansas'), 'ORT');
  assert.equal(deriveOrgKey('9 Lives Labs'), 'LIV');
  assert.equal(deriveOrgKey('Ω'), 'WP');
});

test('organization is unconfigured until a name is saved', async () => {
  const store = await tempStore();
  assert.deepEqual(await store.describe(), { configured: false, organization: null });
  await assert.rejects(store.update({ ceoName: 'Ada' }), /name is required/);
  const { organization, identityChanged } = await store.update({ name: '  Acme   Robotics ' });
  assert.equal(identityChanged, true);
  assert.equal(organization.name, 'Acme Robotics');
  assert.equal(organization.key, 'ACM');
  assert.equal(organization.ceoName, 'CEO');
  assert.equal(organization.logo, null);
  assert.equal((await store.describe()).configured, true);
});

test('organization updates keep unspecified fields and validate input', async () => {
  const store = await tempStore();
  await store.update({ name: 'Acme', key: 'acme', ceoName: 'Ada' });
  const renamed = await store.update({ name: 'Acme Two' });
  assert.equal(renamed.organization.key, 'ACME');
  assert.equal(renamed.organization.ceoName, 'Ada');
  assert.equal((await store.update({ logo: tinyPng })).identityChanged, false);
  assert.equal((await store.get()).logo, tinyPng);
  assert.equal((await store.update({ logo: null })).organization.logo, null);
  await assert.rejects(store.update({ key: '1AB' }), /key must be/);
  await assert.rejects(store.update({ ceoName: '' }), /ceoName must be/);
  await assert.rejects(store.update({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }), /logo must be/);
  await assert.rejects(store.update({ logo: `data:image/png;base64,${Buffer.alloc(LOGO_MAX_BYTES + 1).toString('base64')}` }), /at most/);
  await assert.rejects(store.update({ owner: 'x' }), /unsupported organization fields/);
});

test('organization routes save and validate settings', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-org-http-'));
  const app = await createApp({ DATA_DIR: dataDir, WAYPOINT_CONTROL_DIR: path.join(dataDir, 'control'), LOG_LEVEL: 'error', HERMES_AUTO_START: 'false' });
  app.hermes.refreshCeoIdentity = async () => ({ refreshed: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.deepEqual(await fetch(`${base}/organization`).then((r) => r.json()), { configured: false, organization: null });
    const saved = await fetch(`${base}/organization`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme', ceoName: 'Ada' }) });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).organization.key, 'ACM');
    const bad = await fetch(`${base}/organization`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }) });
    assert.equal(bad.status, 400);
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
});
