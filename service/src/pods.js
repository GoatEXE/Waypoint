import { createHash } from 'node:crypto';
import path from 'node:path';
import { badRequest, conflict, lifecycleError, notFound } from './errors.js';
import { readJson, writeJson } from './store.js';
import { APPLY_SCRIPT, LEARNING_SCRIPT, SNAPSHOT_SCRIPT } from './podLearning.js';

const POD_NAME_RE = /^[a-z][a-z0-9-]{1,14}$/;
const SEAT_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const PURPOSE_MAX = 300;

export function rosterSkill(pod) {
  const members = pod.seats.map((seat) => `- ${seat.id}: ${seat.description || seat.from} (cloned from ${seat.from})`).join('\n');
  return `---
name: waypoint-pod
description: Who is in your pod and how to work with them. Use whenever you work on a ${pod.slug} task.
---

# Pod ${pod.name}

${pod.purpose || 'A team working together on one piece of work.'}

Your pod's kanban board is ${pod.slug}. The kanban tools you use while working a pod task act on that board.

Podmates:
${members}

Work with your podmates through the board, so the user can follow the conversation:
- To ask a podmate for something, create a task assigned to them with kanban_create. If you need their answer before you can continue, link your task to wait on it and block with kind "dependency".
- To answer or add to someone's work, comment on their task with kanban_comment.
- Keep each message short and specific. Name the podmate you mean.
`;
}

export class Pods {
  constructor({ config, hermes, board, orgSeats }) {
    this.config = config;
    this.hermes = hermes;
    this.board = board;
    this.orgSeats = orgSeats;
    this.filePath = path.join(config.dataDir, 'pods.json');
    this.queue = Promise.resolve();
  }

  async records() {
    return (await readJson(this.filePath))?.pods || [];
  }

  update(change) {
    const next = this.queue.then(async () => {
      const pods = await this.records();
      const result = await change(pods);
      await writeJson(this.filePath, { pods });
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async seatIds() {
    return new Set((await this.records()).flatMap((pod) => pod.seats.map((seat) => seat.id)));
  }

  async list() {
    return { pods: (await this.records()).sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || a.name.localeCompare(b.name)) };
  }

  async get(name) {
    const pod = (await this.records()).find((item) => item.name === name || item.slug === name);
    if (!pod) throw notFound('pod not found', { pod: String(name).slice(0, 40) });
    return pod;
  }

  async show(name) {
    const pod = await this.get(name);
    const { tasks } = pod.status === 'closed' ? { tasks: [] } : await this.board.list({ board: pod.slug });
    return { ...pod, tasks };
  }

  async conversation(name) {
    const pod = await this.get(name);
    if (pod.status === 'closed') return { pod: pod.name, entries: [] };
    const { tasks } = await this.board.list({ board: pod.slug });
    const entries = [];
    for (const task of tasks) {
      const detail = await this.board.show(task.id);
      const about = { ref: detail.ref, title: detail.title };
      entries.push({ at: detail.createdAt, kind: 'task', author: detail.createdBy || 'user', text: detail.body, to: detail.assignee, ...about });
      for (const comment of detail.comments) entries.push({ at: comment.at, kind: 'comment', author: comment.author, text: comment.body, ...about });
      for (const event of detail.events) {
        if (['review_requested', 'completed', 'blocked'].includes(event.kind) && event.detail) entries.push({ at: event.at, kind: event.kind, author: detail.assignee, text: event.detail, ...about });
      }
    }
    return { pod: pod.name, entries: entries.filter((entry) => entry.at).sort((a, b) => a.at.localeCompare(b.at)) };
  }

  async create(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['name', 'purpose', 'seats', 'durable'].includes(key))) throw badRequest('body must be { name, purpose?, seats, durable? }');
    const name = String(input.name || '').trim();
    if (!POD_NAME_RE.test(name)) throw badRequest('pod name must be 2-15 lowercase letters, digits, or dashes, starting with a letter');
    const purpose = typeof input.purpose === 'string' ? input.purpose.trim().replace(/\s+/g, ' ') : '';
    if (purpose.length > PURPOSE_MAX) throw badRequest(`purpose must be at most ${PURPOSE_MAX} characters`);
    const wanted = Array.isArray(input.seats) ? [...new Set(input.seats.map(String))] : [];
    if (!wanted.length) throw badRequest('seats must list at least one seat');
    if (this.config.dryRun) throw conflict('Waypoint is in dry-run mode; pods cannot be created.');
    if ((await this.records()).some((pod) => pod.name === name)) throw conflict('a pod with this name already exists', { name });
    const { seats } = await this.orgSeats.list();
    const seatsById = new Map(seats.map((seat) => [seat.id, seat]));
    const missing = wanted.filter((id) => !seatsById.has(id));
    if (missing.length) throw badRequest('seats must be existing organization seats', { missing });
    const members = wanted.map((from) => ({ id: `${name}-${from}`, from, description: seatsById.get(from).description }));
    const tooLong = members.filter((seat) => !SEAT_ID_RE.test(seat.id));
    if (tooLong.length) throw badRequest('pod name plus seat id must fit in 31 characters', { seats: tooLong.map((seat) => seat.id) });
    const pod = { name, slug: `pod-${name}`, purpose, durable: Boolean(input.durable), status: 'active', seats: members, createdAt: new Date().toISOString(), closedAt: null };

    await this.#hermes(['kanban', 'boards', 'create', pod.slug, '--name', `Pod ${name}`, ...(purpose ? ['--description', purpose] : [])]);
    for (const seat of members) {
      await this.#hermes(['profile', 'create', seat.id, '--no-alias', '--clone-from', seat.from]);
      await this.#hermes(['profile', 'describe', seat.id, '--text', `${seat.description || seat.from} (pod ${name})`.slice(0, 200)]);
    }
    await this.syncRoster(pod);
    pod.baseline = await this.#python(SNAPSHOT_SCRIPT, { seats: members.map((seat) => seat.id) });
    await this.update((pods) => { pods.push(pod); });
    return pod;
  }

  async syncRoster(pod) {
    const skill = rosterSkill(pod);
    await this.hermes.execPython(WRITE_ROSTER_SCRIPT, JSON.stringify({ skill, seats: pod.seats.map((seat) => seat.id) }));
    for (const seat of pod.seats) {
      const current = String((await this.#hermes(['-p', seat.id, 'config', 'get', 'skills.auto_load'])).stdout || '')
        .split('\n').map((line) => line.replace(/^\s*-\s*/, '').trim()).filter((entry) => /^[a-z0-9][a-z0-9_-]*$/.test(entry));
      const wanted = [...new Set([...current, 'waypoint-seat', 'waypoint-pod'])];
      if (wanted.length !== current.length) await this.#hermes(['-p', seat.id, 'config', 'set', 'skills.auto_load', JSON.stringify(wanted)]);
    }
  }

  async close(name) {
    const pod = await this.get(name);
    if (pod.status === 'closed') return pod;
    await this.#hermes(['kanban', 'boards', 'rm', pod.slug]);
    await this.update((pods) => {
      const stored = pods.find((item) => item.name === pod.name);
      stored.status = 'closed';
      stored.closedAt = new Date().toISOString();
    });
    return this.learning(pod.name);
  }

  async learning(name) {
    const pod = await this.get(name);
    if (pod.seatsRemoved) return pod;
    const { items } = await this.#python(LEARNING_SCRIPT, { seats: pod.seats.map((seat) => ({ id: seat.id, from: seat.from, baseline: pod.baseline?.[seat.id] || null })) });
    const previous = new Map((pod.learning?.items || []).map((item) => [item.id, item]));
    const fresh = items.map((item) => {
      const id = createHash('sha256').update([item.seat, item.kind, item.path, item.text].join('\0')).digest('hex').slice(0, 16);
      return { id, ...item, decision: previous.get(id)?.decision || null };
    });
    await this.update((pods) => {
      const stored = pods.find((entry) => entry.name === pod.name);
      stored.learning = { computedAt: new Date().toISOString(), items: fresh };
    });
    return this.settle(pod.name);
  }

  async decide(name, itemId, input = {}) {
    if (!input || typeof input !== 'object' || !['apply', 'drop'].includes(input.decision)) throw badRequest('decision must be apply or drop');
    const pod = await this.get(name);
    const item = pod.learning?.items?.find((entry) => entry.id === itemId);
    if (!item) throw notFound('learning item not found');
    if (item.decision) throw conflict('this learning item is already decided', { decision: item.decision });
    if (input.decision === 'apply') await this.#python(APPLY_SCRIPT, { kind: item.kind, seat: item.seat, from: item.from, path: item.path, text: item.text });
    await this.update((pods) => {
      const stored = pods.find((entry) => entry.name === pod.name).learning.items.find((entry) => entry.id === itemId);
      stored.decision = input.decision;
    });
    return this.settle(pod.name);
  }

  async settle(name) {
    const pod = await this.get(name);
    const pending = (pod.learning?.items || []).some((item) => !item.decision);
    if (pending || !pod.learning) return pod;
    if (pod.status === 'closed' && !pod.durable) {
      for (const seat of pod.seats) await this.#hermes(['profile', 'delete', '-y', seat.id]).catch(() => null);
      return this.update((pods) => {
        const stored = pods.find((entry) => entry.name === pod.name);
        stored.seatsRemoved = true;
        return stored;
      });
    }
    const baseline = await this.#python(SNAPSHOT_SCRIPT, { seats: pod.seats.map((seat) => seat.id) });
    return this.update((pods) => {
      const stored = pods.find((entry) => entry.name === pod.name);
      stored.baseline = baseline;
      stored.learning = { ...stored.learning, items: [], reviewedAt: new Date().toISOString() };
      return stored;
    });
  }

  async #python(script, input) {
    const result = await this.hermes.execPython(script, JSON.stringify(input), { timeoutMs: 60000, outputLimitBytes: 2 * 1024 * 1024 });
    return JSON.parse(String(result.stdout).trim().split('\n').pop());
  }

  async #hermes(args) {
    const result = await this.hermes.runner('docker', ['exec', '--user', 'hermes', this.hermes.containerName, 'hermes', ...args], { timeoutMs: 60000, outputLimitBytes: 64 * 1024 });
    if (result.code !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim().split('\n').pop().slice(0, 200);
      throw lifecycleError(`hermes ${args.slice(0, 3).join(' ')} failed${detail ? `: ${detail}` : ''}`, { code: result.code });
    }
    return result;
  }
}

export const WRITE_ROSTER_SCRIPT = String.raw`
import json, os, sys, yaml
p = json.loads(sys.stdin.read())
for seat in p['seats']:
    home = os.path.join('/opt/data/profiles', seat)
    folder = os.path.join(home, 'skills', 'waypoint-pod')
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'SKILL.md'), 'w', encoding='utf-8') as handle:
        handle.write(p['skill'])
print(json.dumps({'ok': True}))
`;
