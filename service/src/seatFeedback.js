import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest, conflict, lifecycleError } from './errors.js';
import { applyStreamEvent, finalActivity, publicActivity } from './activity.js';
import { runCeoChatChild } from './hermes.js';

const SEAT_RE = /^[a-z][a-z0-9-]{1,30}$/;
const MESSAGE_MAX = 4000;
const MESSAGES_MAX = 200;

const RATING_TEXT = { up: 'thumbs up (this went well)', down: 'thumbs down (this missed the mark)' };

export function feedbackLine(seat, rating, message) {
  const mark = rating === 'up' ? '👍' : rating === 'down' ? '👎' : '';
  return `${mark ? `${mark} ` : ''}Feedback for ${seat}: ${message}`;
}

export function feedbackPrompt(seat, task, message, rating = null) {
  const summary = task.latestSummary ? `\nYour handoff summary was:\n${task.latestSummary.slice(0, 2000)}\n` : '';
  return `The user is giving you, ${seat}, feedback on task ${task.ref || task.id} "${task.title}", which you worked on.${summary}
${rating ? `They rated it ${RATING_TEXT[rating]}.\n` : ''}Talk it through with them. When you understand what to do differently, save it as a durable lesson with your memory tool (or update one of your skills) so future tasks follow it, and tell the user what you saved.

User: ${message}`;
}

export function buildSeatChatArgs(containerName, seat, sessionName, hermesConfig) {
  const timeoutSeconds = Math.max(1, Math.ceil(hermesConfig.ceoTurnTimeoutMs / 1000));
  return ['exec', '-i', '--user', 'hermes', containerName, 'timeout', '--kill-after=2s', `${timeoutSeconds}s`, 'hermes', '-p', seat, 'chat', '--query-file', '-', '--format', 'stream-json', '--continue', sessionName, '--create-if-missing', '--source', 'tool', '--in', '/opt/data', '--max-turns', String(hermesConfig.ceoMaxTurns)];
}

export class SeatFeedback {
  constructor({ config, hermes, board }) {
    this.config = config;
    this.hermes = hermes;
    this.board = board;
    this.live = new Map();
  }

  key(seat, taskId) { return `${seat}__${taskId}`; }
  file(seat, taskId) { return path.join(this.config.dataDir, 'seat-feedback', `${this.key(seat, taskId)}.json`); }

  async read(seat, taskId) {
    try { return JSON.parse(await fs.readFile(this.file(seat, taskId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { messages: [] }; throw error; }
  }

  async write(seat, taskId, value) {
    await fs.mkdir(path.dirname(this.file(seat, taskId)), { recursive: true });
    await fs.writeFile(this.file(seat, taskId), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }

  async resolve(seat, ref) {
    if (!SEAT_RE.test(String(seat || ''))) throw badRequest('seat must be a seat id');
    const task = await this.board.show(ref);
    if (task.assignee !== seat) throw badRequest('feedback goes to the seat assigned to the task', { assignee: task.assignee });
    return task;
  }

  async conversation(seat, ref) {
    const task = await this.resolve(seat, ref);
    const stored = await this.read(seat, task.id);
    const live = this.live.get(this.key(seat, task.id));
    return { seat, task: task.ref || task.id, messages: stored.messages, live: live ? { startedAt: live.startedAt, message: live.message, items: publicActivity(live.activity) } : null };
  }

  async send(seat, ref, input = {}) {
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    const rating = input?.rating === 'up' || input?.rating === 'down' ? input.rating : null;
    if (!message || message.length > MESSAGE_MAX) throw badRequest(`message must be 1-${MESSAGE_MAX} characters`);
    const task = await this.resolve(seat, ref);
    const key = this.key(seat, task.id);
    if (this.live.has(key)) throw conflict(`${seat} is still answering. Wait for the reply.`);
    const turn = { startedAt: new Date().toISOString(), message, activity: [] };
    this.live.set(key, turn);
    try {
      const stored = await this.read(seat, task.id);
      const prompt = stored.messages.length ? message : feedbackPrompt(seat, task, message, rating);
      await this.board.note?.(task.id, 'user', feedbackLine(seat, rating, message)).catch(() => undefined);
      const args = buildSeatChatArgs(this.hermes.containerName, seat, `waypoint-feedback-${task.id}`, this.config.hermes);
      const child = this.hermes.spawner('docker', args, { timeoutMs: this.config.hermes.ceoTurnTimeoutMs });
      const result = await runCeoChatChild(child, prompt, {
        timeoutMs: this.config.hermes.ceoTurnTimeoutMs,
        outputLimitBytes: this.config.hermes.ceoOutputLimitBytes,
        onEvent: (event) => applyStreamEvent(turn.activity, event, [this.config.bridge.token]),
      });
      if (!result.reply) throw lifecycleError(`${seat} did not reply.`);
      const activity = finalActivity(turn.activity);
      const messages = [
        ...stored.messages,
        { role: 'user', text: message, at: turn.startedAt, ...(rating ? { rating } : {}) },
        ...(activity.length ? [{ role: 'activity', items: activity, at: turn.startedAt }] : []),
        { role: 'seat', text: String(result.reply).slice(0, MESSAGE_MAX * 4), at: new Date().toISOString() },
      ].slice(-MESSAGES_MAX);
      await this.write(seat, task.id, { messages });
      await this.board.note?.(task.id, seat, String(result.reply).slice(0, 4000)).catch(() => undefined);
      return { seat, task: task.ref || task.id, messages, live: null };
    } finally {
      this.live.delete(key);
    }
  }
}
