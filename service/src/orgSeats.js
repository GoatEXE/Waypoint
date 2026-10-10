import { badRequest, conflict, lifecycleError } from './errors.js';

const SEAT_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED = new Set(['default', 'ceo', 'hermes']);
const DESCRIPTION_MAX = 200;

export const LIST_SEATS_SCRIPT = String.raw`
import json, os, re
root = '/opt/data/profiles'
def field(path, key):
    try:
        for line in open(path, encoding='utf-8'):
            m = re.match(r'^\s*' + key + r':\s*(.*)$', line)
            if m:
                return m.group(1).strip().strip('"').strip("'")
    except OSError:
        return ''
    return ''
seats = []
for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
    home = os.path.join(root, name)
    if not os.path.isfile(os.path.join(home, 'config.yaml')):
        continue
    seats.append({'id': name, 'description': field(os.path.join(home, 'profile.yaml'), 'description'), 'model': field(os.path.join(home, 'config.yaml'), 'default'), 'provider': field(os.path.join(home, 'config.yaml'), 'provider')})
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
    const result = await this.hermes.execPython(LIST_SEATS_SCRIPT, '', { timeoutMs: 20000, outputLimitBytes: 256 * 1024 });
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
