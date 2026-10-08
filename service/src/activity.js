const KINDS = new Set(['tool', 'action']);
const STATES = new Set(['running', 'ok', 'error', 'unknown']);
export const ACTIVITY_MAX_ITEMS = 60;
const DETAIL_MAX = 200;
const INPUT_KEYS = ['command', 'cmd', 'code', 'path', 'file_path', 'url', 'query', 'pattern', 'name', 'skill'];

export function redactActivityText(text, secrets = []) {
  let safe = String(text || '');
  for (const secret of secrets) {
    const value = String(secret || '');
    if (value.length >= 8) safe = safe.split(value).join('[redacted]');
  }
  return safe
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted:private-key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted:key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, '[redacted:key]')
    .replace(/\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}["']?/gi, '$1=[redacted]');
}

export function activityDetail(value, secrets = []) {
  return redactActivityText(value, secrets).replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX);
}

function toolInputSummary(input) {
  if (!input || typeof input !== 'object') return '';
  for (const key of INPUT_KEYS) if (typeof input[key] === 'string' && input[key].trim()) return input[key];
  try { return JSON.stringify(input); } catch { return ''; }
}

export function pushActivity(items, item) {
  items.push({ ...item, at: new Date().toISOString() });
  if (items.length > ACTIVITY_MAX_ITEMS) items.splice(0, items.length - ACTIVITY_MAX_ITEMS);
}

export function applyStreamEvent(items, event, secrets = []) {
  const type = String(event?.type || '');
  const id = typeof event?.tool_call_id === 'string' ? event.tool_call_id.slice(0, 80) : undefined;
  if (type === 'tool_use') {
    pushActivity(items, { kind: 'tool', id, name: event.name, detail: activityDetail(toolInputSummary(event.input), secrets), status: 'running' });
  } else if (type === 'tool_result') {
    const item = [...items].reverse().find((entry) => entry.kind === 'tool' && entry.status === 'running' && (id ? entry.id === id : entry.name === String(event.name || '')));
    if (!item) return;
    item.status = event.is_error ? 'error' : 'ok';
    if (Number.isSafeInteger(event.duration_ms) && event.duration_ms >= 0) item.durationMs = event.duration_ms;
  }
}

export function streamLineReader(onEvent, limit = 65536) {
  let pending = '';
  return (chunk) => {
    const lines = (pending + String(chunk || '')).split(/\r?\n/);
    pending = lines.pop().slice(-limit);
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      try { onEvent(event); } catch {   }
    }
  };
}

export function publicActivity(items) {
  return items.map(({ id: _id, ...item }) => item);
}

export function finalActivity(items) {
  return items.map(({ id: _id, at: _at, ...item }) => ({ ...item, status: item.status === 'running' ? 'unknown' : item.status }));
}

export function normalizeActivity(items, secrets = []) {
  if (!Array.isArray(items)) return [];
  return items.slice(-ACTIVITY_MAX_ITEMS).filter((item) => item && KINDS.has(item.kind)).map((item) => {
    const entry = {
      kind: item.kind,
      name: String(item.name || 'unknown').replace(/[^A-Za-z0-9_.:/ -]/g, '').slice(0, 64) || 'unknown',
      detail: activityDetail(item.detail, secrets),
      status: STATES.has(item.status) ? item.status : 'unknown',
    };
    if (Number.isSafeInteger(item.durationMs) && item.durationMs >= 0) entry.durationMs = item.durationMs;
    return entry;
  });
}
