import { badRequest, conflict, lifecycleError } from './errors.js';

export const USAGE_SCRIPT = String.raw`
import glob, json, os, sqlite3, sys
p = json.loads(sys.stdin.read() or '{}')
home = os.environ['HERMES_HOME']
offset = int(p.get('tzOffsetMinutes') or 0) * 60
METERED = {'openai-api', 'openai', 'openrouter'}
SUBSCRIPTION = {'openai-codex'}

def day_of(ts):
    return int((float(ts) - offset) // 86400)

def read_env(path):
    env = {}
    try:
        for line in open(path, encoding='utf-8'):
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.rstrip('\n').split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env

def anthropic_api_key(profile_home):
    from agent.anthropic_credentials import _is_oauth_token
    env = {**read_env(os.path.join(home, '.env')), **read_env(os.path.join(profile_home, '.env'))}
    get = lambda k: (env.get(k) or os.environ.get(k) or '').strip()
    token = get('ANTHROPIC_TOKEN') or get('CLAUDE_CODE_OAUTH_TOKEN')
    if token:
        return not _is_oauth_token(token)
    key = get('ANTHROPIC_API_KEY')
    if key:
        return not _is_oauth_token(key)
    return False

agents = [('ceo', home)] + [(os.path.basename(d), d) for d in sorted(glob.glob(os.path.join(home, 'profiles', '*'))) if os.path.isdir(d)]
days = {}
def bucket(day):
    return days.setdefault(day, {'day': day, 'tasks': 0, 'sessions': 0, 'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'cost': 0.0, 'costSessions': 0, 'costUnknown': 0, 'agents': {}})

billing = {'apiKey': False, 'subscription': False, 'providers': []}
missing = []
for agent, agent_home in agents:
    db = os.path.join(agent_home, 'state.db')
    if not os.path.exists(db):
        continue
    key_billed = anthropic_api_key(agent_home)
    try:
        conn = sqlite3.connect('file:%s?mode=ro' % db, uri=True, timeout=5)
        rows = conn.execute("SELECT started_at, COALESCE(input_tokens,0), COALESCE(output_tokens,0), COALESCE(cache_read_tokens,0), COALESCE(cache_write_tokens,0), COALESCE(billing_provider,''), COALESCE(billing_mode,''), cost_status, COALESCE(actual_cost_usd, estimated_cost_usd) FROM sessions WHERE started_at IS NOT NULL").fetchall()
        conn.close()
    except Exception:
        missing.append(agent)
        continue
    for started, i, o, cr, cw, provider, mode, status, cost in rows:
        total = i + o + cr + cw
        if not total:
            continue
        b = bucket(day_of(started))
        b['sessions'] += 1
        b['input'] += i; b['output'] += o; b['cacheRead'] += cr; b['cacheWrite'] += cw
        b['agents'][agent] = b['agents'].get(agent, 0) + total
        provider = provider.lower()
        subscription = mode == 'subscription_included' or provider in SUBSCRIPTION or (provider == 'anthropic' and not key_billed)
        metered = not subscription and (provider in METERED or provider == 'anthropic')
        if subscription:
            billing['subscription'] = True
        if metered:
            billing['apiKey'] = True
            if provider not in billing['providers']:
                billing['providers'].append(provider)
            if status in ('actual', 'estimated') and cost is not None:
                b['cost'] += float(cost); b['costSessions'] += 1
            else:
                b['costUnknown'] += 1

boards = [os.path.join(home, 'kanban.db')] + sorted(glob.glob(os.path.join(home, 'kanban', 'boards', '*', 'kanban.db'))) + sorted(glob.glob(os.path.join(home, 'kanban', 'boards', '_archived', '*', 'kanban.db')))
for db in boards:
    if not os.path.exists(db):
        continue
    try:
        conn = sqlite3.connect('file:%s?mode=ro' % db, uri=True, timeout=5)
        for (completed,) in conn.execute("SELECT completed_at FROM tasks WHERE completed_at IS NOT NULL"):
            bucket(day_of(completed))['tasks'] += 1
        conn.close()
    except Exception:
        missing.append(os.path.relpath(db, home))

print(json.dumps({'days': sorted(days.values(), key=lambda d: d['day']), 'agents': [a for a, _ in agents], 'billing': billing, 'unreadable': missing}))
`;

export const READ_USER_MEMORY_SCRIPT = String.raw`
import json
from tools.memory_tool import load_on_disk_store, ENTRY_DELIMITER
store = load_on_disk_store()
entries = list(store.user_entries)
print(json.dumps({'entries': entries, 'used': len(ENTRY_DELIMITER.join(entries)), 'limit': store.user_char_limit, 'enabled': store.user_profile_enabled}))
`;

export const WRITE_USER_MEMORY_SCRIPT = String.raw`
import json, sys
p = json.loads(sys.stdin.read() or '{}')
from tools.memory_tool import load_on_disk_store, ENTRY_DELIMITER, _scan_memory_content
store = load_on_disk_store()
entries = [e.strip() for e in p.get('entries', []) if isinstance(e, str) and e.strip()]
entries = list(dict.fromkeys(entries))
base = p.get('base')
def out(value):
    print(json.dumps(value)); sys.exit(0)
for e in entries:
    problem = _scan_memory_content(e)
    if problem:
        out({'ok': False, 'code': 'rejected', 'error': problem})
def replace(current, limit):
    if base is not None and list(current) != list(base):
        return {'ok': False, 'code': 'stale', 'error': 'USER.md changed since you opened it.'}
    used = len(ENTRY_DELIMITER.join(entries))
    if used > limit:
        return {'ok': False, 'code': 'limit', 'error': 'USER.md would be %d of %d characters.' % (used, limit)}
    return entries, 'Saved.'
result = store._mutate('user', replace, skip_drift=True)
if result.get('ok') is False:
    out(result)
if not result.get('success'):
    out({'ok': False, 'code': 'rejected', 'error': str(result.get('error') or 'USER.md could not be saved.')[:300]})
out({'ok': True, 'entries': list(store.user_entries), 'used': len(ENTRY_DELIMITER.join(store.user_entries)), 'limit': store.user_char_limit, 'enabled': store.user_profile_enabled})
`;

const ENTRY_MAX = 2000;
const ENTRIES_MAX = 100;

function parseLast(stdout, message) {
  try { return JSON.parse(String(stdout || '').trim().split('\n').pop() || '{}'); }
  catch { throw lifecycleError(message); }
}

function cleanEntries(value, field) {
  if (!Array.isArray(value) || value.length > ENTRIES_MAX || value.some((entry) => typeof entry !== 'string' || entry.length > ENTRY_MAX || entry.includes('\0'))) throw badRequest(`${field} must be a list of up to ${ENTRIES_MAX} text entries`);
  return value;
}

export class ProfileData {
  constructor({ hermes }) {
    this.hermes = hermes;
  }

  async #running() {
    const inspected = await this.hermes.inspect({ allowMissing: true });
    return inspected.exists && inspected.state.running;
  }

  async usage({ tzOffsetMinutes = 0 } = {}) {
    const tz = Number(tzOffsetMinutes);
    if (!Number.isInteger(tz) || Math.abs(tz) > 900) throw badRequest('tz must be a whole number of minutes');
    if (!(await this.#running())) return { available: false, days: [], agents: [], billing: { apiKey: false, subscription: false, providers: [] }, unreadable: [] };
    const result = await this.hermes.execPython(USAGE_SCRIPT, JSON.stringify({ tzOffsetMinutes: tz }), { timeoutMs: 30000, outputLimitBytes: 2 * 1024 * 1024 });
    return { available: true, ...parseLast(result.stdout, 'Hermes usage returned an unexpected shape') };
  }

  async userMemory() {
    if (!(await this.#running())) return { available: false, entries: [], used: 0, limit: 0, enabled: false };
    const result = await this.hermes.execPython(READ_USER_MEMORY_SCRIPT, '{}', { timeoutMs: 20000, outputLimitBytes: 256 * 1024 });
    return { available: true, ...parseLast(result.stdout, 'USER.md returned an unexpected shape') };
  }

  async saveUserMemory(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['entries', 'base'].includes(key))) throw badRequest('body must be { entries, base? }');
    const entries = cleanEntries(input.entries, 'entries');
    const base = input.base === undefined ? null : cleanEntries(input.base, 'base');
    if (!(await this.#running())) throw conflict('Start the CEO to edit what it knows about you.');
    const result = await this.hermes.execPython(WRITE_USER_MEMORY_SCRIPT, JSON.stringify({ entries, base }), { timeoutMs: 20000, outputLimitBytes: 256 * 1024 });
    const parsed = parseLast(result.stdout, 'USER.md returned an unexpected shape');
    if (parsed.ok) { const { ok, ...rest } = parsed; return { available: true, ...rest }; }
    if (parsed.code === 'stale') throw conflict(parsed.error);
    throw badRequest(String(parsed.error || 'USER.md could not be saved.'));
  }
}
