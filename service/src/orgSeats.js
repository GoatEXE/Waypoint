import { badRequest, conflict, lifecycleError } from './errors.js';

const SEAT_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED = new Set(['default', 'ceo', 'hermes']);
const DESCRIPTION_MAX = 200;

export const SEAT_SKILL = `---
name: waypoint-seat
description: How work moves through the user's approval in this Waypoint organization. Use when you finish a kanban task.
---

# Finishing a task

Review is the user's approval gate, and you own the handoff into it.

1. If something should happen once the user approves (filing issues, implementing a fix, reviewing a PR), create that follow-up now with kanban_create: parent it on your task and assign the best-suited seat ("hermes profile list" shows the seats and what they do). It waits until your task is approved. Write its body so that seat can start without asking you.
2. Hand your task in with kanban_request_review. The summary is what the user reads: the result, then "On approval:" and what happens next and who does it.

If a peer should check your work before the user sees it, create a review task for that seat with kanban_create, make your task wait on it with kanban_link (the review task is the parent), and end your run with kanban_block using kind "dependency". Your task resumes when the review is done, with the reviewer's result in your context; address it, then hand in as above.

Complete a task directly only when it says no approval is needed. If you need a decision before you can finish, use kanban_block with the question.
`;

export const LIST_SEATS_SCRIPT = String.raw`
import json, os, sys, yaml
skill = json.loads(sys.stdin.read() or '{}').get('skill', '')
root = '/opt/data/profiles'
def sync_skill(home):
    folder = os.path.join(home, 'skills', 'waypoint-seat')
    path = os.path.join(folder, 'SKILL.md')
    try:
        if open(path, encoding='utf-8').read() == skill:
            return
    except OSError:
        pass
    os.makedirs(folder, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(skill)
def load(path):
    try:
        data = yaml.safe_load(open(path, encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, yaml.YAMLError):
        return {}
def text(value):
    return value.strip() if isinstance(value, str) else ''
seats = []
for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
    home = os.path.join(root, name)
    if not os.path.isfile(os.path.join(home, 'config.yaml')):
        continue
    if skill:
        sync_skill(home)
    model = load(os.path.join(home, 'config.yaml')).get('model')
    model = model if isinstance(model, dict) else {}
    seats.append({'id': name, 'description': text(load(os.path.join(home, 'profile.yaml')).get('description')), 'model': text(model.get('default')), 'provider': text(model.get('provider'))})
print(json.dumps({'seats': seats}))
`;

export const WRITE_SOUL_SCRIPT = String.raw`
import json, os, sys
p = json.loads(sys.stdin.read())
path = os.path.join('/opt/data/profiles', p['id'], 'SOUL.md')
with open(path, 'w', encoding='utf-8') as handle:
    handle.write(p['soul'])
os.chmod(path, 0o600)
print(json.dumps({'ok': True}))
`;

export class OrgSeats {
  constructor({ config, hermes }) {
    this.config = config;
    this.hermes = hermes;
  }

  async list() {
    const result = await this.hermes.execPython(LIST_SEATS_SCRIPT, JSON.stringify({ skill: SEAT_SKILL }), { timeoutMs: 20000, outputLimitBytes: 256 * 1024 });
    const parsed = JSON.parse(String(result.stdout).trim().split('\n').pop());
    return { seats: (parsed.seats || []).filter((seat) => SEAT_ID_RE.test(seat.id)) };
  }

  async hire(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['id', 'description', 'cloneFrom'].includes(key))) throw badRequest('body must be { id, description, cloneFrom? }');
    const id = String(input.id || '').trim();
    if (!SEAT_ID_RE.test(id) || RESERVED.has(id)) throw badRequest('seat id must be 2-31 lowercase letters, digits, or dashes, starting with a letter');
    const description = typeof input.description === 'string' ? input.description.trim().replace(/\s+/g, ' ') : '';
    if (!description || description.length > DESCRIPTION_MAX) throw badRequest(`description must be 1-${DESCRIPTION_MAX} characters`);
    const cloneFrom = input.cloneFrom ? String(input.cloneFrom) : '';
    if (this.config.dryRun) throw conflict('Waypoint is in dry-run mode; seats cannot be hired.');
    const { seats } = await this.list();
    if (seats.some((seat) => seat.id === id)) throw conflict('a seat with this id already exists', { id });
    if (cloneFrom && !seats.some((seat) => seat.id === cloneFrom)) throw badRequest('cloneFrom must be an existing seat', { cloneFrom });
    await this.#hermes(['profile', 'create', id, '--no-alias', ...(cloneFrom ? ['--clone-from', cloneFrom] : [])]);
    if (!cloneFrom) {
      const ceo = await this.hermes.status().catch(() => null);
      if (ceo?.model?.provider) await this.#hermes(['-p', id, 'config', 'set', 'model.provider', ceo.model.provider]);
      if (ceo?.model?.default) await this.#hermes(['-p', id, 'config', 'set', 'model.default', ceo.model.default]);
      await this.hermes.execPython(WRITE_SOUL_SCRIPT, JSON.stringify({ id, soul: `# ${id}\n\nYou are the ${id} seat in this organization. ${description}\n\nWork comes to you as tasks on the organization's kanban board. Keep your discussion on the task thread so the team can follow it.\n` }));
    }
    await this.#hermes(['profile', 'describe', id, '--text', description]);
    return { seat: (await this.list()).seats.find((seat) => seat.id === id) || { id, description } };
  }

  async #hermes(args) {
    const result = await this.hermes.runner('docker', ['exec', '--user', 'hermes', this.hermes.containerName, 'hermes', ...args], { timeoutMs: 60000, outputLimitBytes: 16 * 1024 });
    if (result.code !== 0) throw lifecycleError(`hermes ${args.filter((arg) => !arg.includes(' ')).slice(0, 3).join(' ')} failed`, { code: result.code });
    return result;
  }
}
