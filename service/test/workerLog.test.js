import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkerLog } from '../src/kanban.js';

const LOG = [
  'Query: work kanban task t_a7784338',
  'Initializing agent...',
  '  ┊ ⚡ preparing mcp__kanban_show…',
  '  ┊ ⚡ kanban_sh   0.0s',
  '  ┊ 💻 $         (gh repo clone GoatEXE/Waypoint + 2 commands  2.0s',
  '  ┊ 📖 read      README.md  0.0s',
  '',
  '┌─ Reasoning ──────────────────────────────────────────────────────────────────┐',
  'I should look through the frontend codebase, roughly 4000 lines across the app, star',
  'ting with the key files.',
  '└──────────────────────────────────────────────────────────────────────────────┘',
  '  ┊ 💻 $         curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwx" https://x  0.3s',
  '[kanban-worker-exit] rc=0',
].join('\n');

test('worker logs become tool and thought activity without preparing noise', () => {
  const { items, finished } = parseWorkerLog(LOG);
  assert.equal(finished, true);
  assert.deepEqual(items.slice(0, 3), [
    { kind: 'tool', icon: '⚡', name: 'kanban_sh', detail: '', duration: '0.0s' },
    { kind: 'tool', icon: '💻', name: '$', detail: '(gh repo clone GoatEXE/Waypoint + 2 commands', duration: '2.0s' },
    { kind: 'tool', icon: '📖', name: 'read', detail: 'README.md', duration: '0.0s' },
  ]);
  assert.deepEqual(items[3], { kind: 'thought', detail: 'I should look through the frontend codebase, roughly 4000 lines across the app, starting with the key files.' });
  assert.equal(items[4].detail.includes('abcdefghijklmnop'), false);
});

test('an unfinished log is not marked finished', () => {
  assert.equal(parseWorkerLog('  ┊ 📖 read      a.md  0.0s').finished, false);
  assert.deepEqual(parseWorkerLog('').items, []);
});
