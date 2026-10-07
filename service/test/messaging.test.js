import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { MessagingService, seatAddress } from '../src/messaging.js';

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-messaging-'));
  const app = await createApp({ DATA_DIR: dataDir, HERMES_AUTO_START: 'false', LOG_LEVEL: 'error', DRY_RUN: 'true' });
  const template = await app.store.createTemplate({ name: 'team', version: '1', seats: [{ id: 'lead', role: 'Lead' }, { id: 'builder', role: 'Builder' }], baselineFiles: {}, config: {} });
  const first = await app.store.cloneTemplate(template.id, { podName: 'alpha-team' }, () => ({}));
  const second = await app.store.cloneTemplate(template.id, { podName: 'beta-team' }, () => ({}));
  await new Promise((resolve) => app.bridgeServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const bridgeUrl = `http://127.0.0.1:${app.bridgeServer.address().port}/bridge/tools`;
  const controlUrl = `http://127.0.0.1:${app.server.address().port}`;
  return { app, dataDir, first, second, bridgeUrl, controlUrl, async close() {
    await Promise.all([new Promise((resolve) => app.bridgeServer.close(resolve)), new Promise((resolve) => app.server.close(resolve))]);
    await fs.rm(dataDir, { recursive: true, force: true });
  } };
}

async function tool(url, token, name, args = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ tool: name, args }) });
  return { status: response.status, body: await response.json() };
}

test('organization chart lists CEO and current pod seats and searches by role or pod', async () => {
  const f = await fixture();
  try {
    const chart = await tool(f.bridgeUrl, f.app.config.bridge.token, 'org_chart');
    assert.equal(chart.status, 200);
    assert.equal(chart.body.ceo.address, 'ceo');
    assert.equal(chart.body.pods.length, 2);
    assert.deepEqual(chart.body.pods.find((pod) => pod.podId === f.first.id).seats.map((seat) => seat.address), [seatAddress(f.first.id, 'lead'), seatAddress(f.first.id, 'builder')]);
    const found = await tool(f.bridgeUrl, f.app.messaging.seatToken(f.second.id, 'builder'), 'org_chart', { query: 'Lead' });
    assert.equal(found.status, 200);
    assert.equal(found.body.pods.length, 2);
    assert.ok(found.body.pods.every((pod) => pod.seats.length === 1 && pod.seats[0].seatId === 'lead'));
    assert.equal(found.body.ceo, null);
    const host = await fetch(`${f.controlUrl}/org-chart?query=beta`);
    assert.equal(host.status, 200);
    assert.equal((await host.json()).pods[0].podId, f.second.id);
  } finally { await f.close(); }
});

test('CEO to pod, pod to pod, and pod to CEO messages are durable and sender-bound', async () => {
  const f = await fixture();
  try {
    const lead = seatAddress(f.first.id, 'lead');
    const builder = seatAddress(f.second.id, 'builder');
    const leadToken = f.app.messaging.seatToken(f.first.id, 'lead');
    const builderToken = f.app.messaging.seatToken(f.second.id, 'builder');
    const one = await tool(f.bridgeUrl, f.app.config.bridge.token, 'send_message', { to: lead, text: 'Please coordinate the review.' });
    assert.equal(one.status, 200);
    assert.equal(one.body.from, 'ceo');
    const two = await tool(f.bridgeUrl, leadToken, 'send_message', { to: builder, text: 'Can you inspect the app?' });
    assert.equal(two.status, 200);
    assert.equal(two.body.from, lead);
    const three = await tool(f.bridgeUrl, builderToken, 'send_message', { to: 'ceo', text: 'The app inspection is complete.' });
    assert.equal(three.status, 200);
    assert.equal(three.body.from, builder);
    assert.deepEqual((await tool(f.bridgeUrl, leadToken, 'inbox')).body.messages.map((m) => m.id), [one.body.id]);
    assert.deepEqual((await tool(f.bridgeUrl, builderToken, 'inbox')).body.messages.map((m) => m.id), [two.body.id]);
    assert.deepEqual((await tool(f.bridgeUrl, f.app.config.bridge.token, 'inbox')).body.messages.map((m) => m.id), [three.body.id]);
    const ack = await tool(f.bridgeUrl, builderToken, 'ack_message', { messageId: two.body.id });
    assert.equal(ack.status, 200);
    assert.ok(ack.body.readAt);
    assert.deepEqual((await tool(f.bridgeUrl, builderToken, 'inbox')).body.messages, []);
    assert.deepEqual((await tool(f.bridgeUrl, builderToken, 'inbox', { includeRead: true })).body.messages.map((m) => m.id), [two.body.id]);
    assert.equal((await tool(f.bridgeUrl, leadToken, 'ack_message', { messageId: two.body.id })).status, 404);
    const reloaded = await MessagingService.create({ config: f.app.config, store: f.app.store });
    assert.deepEqual((await reloaded.inbox('ceo')).messages.map((m) => m.id), [three.body.id]);
    assert.equal(reloaded.seatToken(f.first.id, 'lead'), leadToken);
  } finally { await f.close(); }
});

test('host delivery overview and review close uncertain alerts without replay', async () => {
  const f = await fixture();
  try {
    const to = seatAddress(f.first.id, 'lead');
    const sent = await f.app.messaging.send('ceo', { to, text: 'Check this result.' });
    assert.equal((await f.app.messaging.listDeliveries()).messages[0].wake.state, 'queued');
    assert.ok(await f.app.messaging.claimWake(to, sent.id));
    await f.app.messaging.finishWake(to, sent.id, 'outcome_unknown', 'manual_review_required');
    const list = await fetch(`${f.controlUrl}/message-deliveries`);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).messages[0].wake.state, 'outcome_unknown');
    assert.equal((await fetch(`${f.bridgeUrl.replace('/bridge/tools', '/message-deliveries')}`)).status, 404);
    const review = await fetch(`${f.controlUrl}/message-deliveries/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, messageId: sent.id }) });
    assert.equal(review.status, 200);
    assert.ok((await review.json()).reviewedAt);
    assert.ok((await f.app.messaging.listDeliveries()).messages[0].readAt);
    assert.equal((await f.app.messaging.listDeliveries()).messages[0].wake.state, 'outcome_unknown');
    assert.equal((await f.app.messaging.reviewDelivery(to, sent.id)).wakeState, 'outcome_unknown', 'review is idempotent');
    assert.deepEqual(await f.app.messaging.pendingWakes(), []);
    const queued = await f.app.messaging.send('ceo', { to, text: 'Queued message.' });
    await assert.rejects(f.app.messaging.reviewDelivery(to, queued.id), (error) => error.status === 409);
  } finally { await f.close(); }
});

test('pod credentials cannot call CEO controls, impersonate a sender, or read another inbox', async () => {
  const f = await fixture();
  try {
    const leadToken = f.app.messaging.seatToken(f.first.id, 'lead');
    const forged = `${leadToken.slice(0, -1)}${leadToken.endsWith('0') ? '1' : '0'}`;
    assert.equal((await tool(f.bridgeUrl, leadToken, 'health')).status, 403);
    assert.equal((await tool(f.bridgeUrl, forged, 'inbox')).status, 403);
    assert.equal((await tool(f.bridgeUrl, 'invalid', 'org_chart')).status, 403);
    assert.equal((await tool(f.bridgeUrl, leadToken, 'send_message', { from: 'ceo', to: 'ceo', text: 'spoofed' })).status, 400);
    assert.equal((await tool(f.bridgeUrl, leadToken, 'inbox', { address: 'ceo' })).status, 400);
    assert.equal((await tool(f.bridgeUrl, leadToken, 'ack_message', { messageId: '../../../x' })).status, 400);
    assert.equal((await tool(f.bridgeUrl, leadToken, 'send_message', { to: 'pod_bad/lead', text: 'bad' })).status, 400);
    assert.equal((await tool(f.bridgeUrl, leadToken, 'send_message', { to: 'ceo', text: 'x'.repeat(4001) })).status, 400);
    const denied = await fetch(`${f.bridgeUrl.replace('/bridge/tools', '/org-chart')}`);
    assert.equal(denied.status, 404);
  } finally { await f.close(); }
});

test('seat tool installation sends the scoped credential through stdin and never through Docker args', async () => {
  const f = await fixture();
  try {
    f.app.config.dryRun = false;
    const calls = [];
    const podSeats = {
      resolveTarget: (_instance, { seatIds }) => ({ podId: f.first.id, containerName: 'owned-pod', seats: seatIds.map((id) => ({ id })) }),
      verifyPod: async () => {},
      runner: async (_command, args, options) => { calls.push({ args, input: JSON.parse(options.input) }); return { code: 0, stdout: '{"installed": true}', stderr: '' }; },
    };
    const result = await f.app.messaging.installSeatTools(f.first, ['lead'], podSeats);
    assert.deepEqual(result, { installed: true, seats: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[calls[0].args.indexOf('--user') + 1], 'hermes');
    assert.equal(calls[0].args.join(' ').includes(calls[0].input.token), false);
    assert.equal(calls[0].input.skill.includes('org builder'), true);
  } finally { await f.close(); }
});
