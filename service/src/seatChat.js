import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest, conflict, notFound } from './errors.js';
import { finalActivity, normalizeActivity, publicActivity, redactActivityText } from './activity.js';
import { markInterruptedTurn } from './hermes.js';

const THREADS_DIR = 'seat-threads';
const POD_ID_RE = /^pod_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEAT_ID_RE = /^[a-z][a-z0-9_-]{1,62}$/;
const MESSAGE_MAX = 4000;
const MESSAGES_KEEP = 100;
const UNKNOWN_MARKER = 'The seat turn ended before Waypoint could confirm the outcome. Nothing is retried automatically; check the seat before sending a follow-up.';

export function seatThreadId(podId, seatId) { return `seat:${podId}/${seatId}`; }

export function seatChatTaskId(podId, seatId) {
  const hex = createHash('sha256').update(`seat-chat:${podId}/${seatId}`).digest('hex');
  return `task_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-MESSAGES_KEEP).filter((m) => m && typeof m.at === 'string' && (['user', 'seat'].includes(m.role) && typeof m.text === 'string' || m.role === 'activity' && Array.isArray(m.items))).map((m) => {
    if (m.role === 'activity') return { role: 'activity', at: m.at, items: normalizeActivity(m.items) };
    const entry = { role: m.role, text: redactActivityText(m.text).slice(0, 8000), at: m.at };
    if (['sent', 'confirmed', 'outcome_unknown'].includes(m.status)) entry.status = m.status;
    return entry;
  });
}

export class SeatChatService {
  constructor({ config, store, executor, logger = undefined }) {
    this.config = config;
    this.store = store;
    this.executor = executor;
    this.logger = logger;
    this.live = new Map();
  }

  async resolve(podId, seatId) {
    if (!POD_ID_RE.test(String(podId)) || !SEAT_ID_RE.test(String(seatId))) throw badRequest('invalid pod or seat id');
    const pod = await this.store.getInstance(podId);
    const seat = pod.seats.find((item) => item.id === seatId);
    if (!seat) throw notFound('seat not found in pod', { podId, seatId });
    return { pod, seat };
  }

  threadPath(podId, seatId) { return path.join(this.config.dataDir, THREADS_DIR, `${podId}__${seatId}.json`); }

  async read(podId, seatId) {
    try { return normalizeMessages(JSON.parse(await fs.readFile(this.threadPath(podId, seatId), 'utf8')).messages); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  async write(podId, seatId, messages) {
    const target = this.threadPath(podId, seatId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ messages: normalizeMessages(messages) }, null, 2), { mode: 0o600 });
    await fs.rename(tmp, target);
  }

  async conversation(podId, seatId) {
    await this.resolve(podId, seatId);
    const threadId = seatThreadId(podId, seatId);
    const live = this.live.get(threadId);
    const messages = await this.read(podId, seatId);
    return { threadId, sessionId: null, messages: live ? messages : markInterruptedTurn(messages), live: live ? { startedAt: live.startedAt, message: live.message, items: publicActivity(live.items) } : null, busyThreadId: live ? threadId : null };
  }

  async send(podId, seatId, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'message')) throw badRequest('body must be { message }');
    const text = typeof input.message === 'string' ? input.message.trim() : '';
    if (!text || text.length > MESSAGE_MAX || text.includes('\0')) throw badRequest(`message must be 1-${MESSAGE_MAX} characters`);
    const { pod, seat } = await this.resolve(podId, seatId);
    const threadId = seatThreadId(podId, seatId);
    if (this.live.has(threadId)) throw conflict('This seat is already answering a message.');
    if (this.config.dryRun) throw conflict('Waypoint is in dry-run mode; seat chat cannot run a model turn.');
    const template = pod.templateId ? await this.store.getTemplate(pod.templateId).catch(() => undefined) : undefined;
    const before = await this.read(podId, seatId);
    const turn = { startedAt: new Date().toISOString(), message: redactActivityText(text), items: [] };
    const prompt = before.length ? text : `The Waypoint user is talking with you directly as seat ${seatId} (${String(seat.role || 'seat').slice(0, 80)}). This is a conversation, not an assigned task: answer questions and discuss work, and only change files or run tools when the user asks.\n\n${text}`;
    this.live.set(threadId, turn);
    let delivered = false;
    try {
      await this.write(podId, seatId, [...before, { role: 'user', text: turn.message, at: turn.startedAt, status: 'sent' }]);
      const result = await this.executor.execute({ task: { id: seatChatTaskId(podId, seatId), podId, seatId, summary: 'Direct chat with the Waypoint user' }, pod, template, prompt, activity: turn.items });
      const confirmed = result.outcome === 'completed';
      const items = finalActivity(turn.items);
      const messages = [
        ...before,
        { role: 'user', text: turn.message, at: turn.startedAt, status: confirmed ? 'sent' : 'outcome_unknown' },
        ...(items.length ? [{ role: 'activity', at: turn.startedAt, items }] : []),
        { role: 'seat', text: confirmed ? result.text : (result.text || UNKNOWN_MARKER), at: new Date().toISOString(), status: confirmed ? 'confirmed' : 'outcome_unknown' },
      ];
      await this.write(podId, seatId, messages);
      delivered = true;
      this.logger?.info?.('seat_chat_turn_finished', { podId, seatId, outcome: result.outcome, steps: items.length });
      return { threadId, sessionId: null, reply: messages.at(-1).text, messages: normalizeMessages(messages) };
    } finally {
      if (!delivered) await this.write(podId, seatId, before).catch((error) => this.logger?.warn?.('seat_chat_pending_restore_failed', { message: error.message }));
      this.live.delete(threadId);
    }
  }
}
