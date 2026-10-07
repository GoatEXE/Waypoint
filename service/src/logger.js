const levels = { error: 0, warn: 1, info: 2, debug: 3 };
export function createLogger({ serviceName = 'waypoint-pod-service', level = 'info' } = {}) {
  const threshold = levels[level] ?? levels.info;
  function write(levelName, event, fields = {}) {
    if ((levels[levelName] ?? levels.info) > threshold) return;
    const record = { ts: new Date().toISOString(), service: serviceName, level: levelName, event, ...redact(fields) };
    const line = JSON.stringify(record);
    if (levelName === 'error' || levelName === 'warn') console.error(line); else console.log(line);
  }
  return {
    error: (event, fields) => write('error', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    info: (event, fields) => write('info', event, fields),
    debug: (event, fields) => write('debug', event, fields),
  };
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'string') return value.replace(/(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_=-]{32,})/g, '[redacted]');
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /secret|token|password|credential|api[_-]?key/i.test(key) ? '[redacted]' : redact(item),
  ]));
}
