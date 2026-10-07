import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSkills, groupSkills, replaceSkill, skillControlsReady, skillsSummary, skillsViewState } from '../src/skillsModel.ts';
import type { HermesSkill, HermesSkillInventory } from '../src/api.ts';

const skill = (name: string, source: HermesSkill['source'], extra: Partial<HermesSkill> = {}): HermesSkill => ({ name, description: '', category: '', source, enabled: true, locked: false, waypoint: false, ...extra });

function inventory(skills: HermesSkill[], available = true): HermesSkillInventory {
  const counts = { total: skills.length, enabled: 0, disabled: 0, builtin: 0, local: 0, hub: 0 };
  for (const s of skills) {
    counts[s.source] += 1;
    if (s.enabled) counts.enabled += 1;
    else counts.disabled += 1;
  }
  return { available, runtime: { state: available ? 'running' : 'missing', running: available }, skills, counts };
}

test('Waypoint skill is grouped apart from added skills and Hermes built-ins', () => {
  const groups = groupSkills([
    skill('codex', 'builtin', { category: 'autonomous-ai-agents' }),
    skill('waypoint-ceo-bridge', 'local', { waypoint: true, locked: true }),
    skill('my-notes', 'local'),
  ]);
  assert.deepEqual(groups.map(g => [g.id, g.skills.map(s => s.name)]), [
    ['waypoint', ['waypoint-ceo-bridge']],
    ['added', ['my-notes']],
    ['builtin', ['codex']],
  ]);
});

test('view state covers loading, error, stopped, empty, and ready', () => {
  assert.equal(skillsViewState(null, ''), 'loading');
  assert.equal(skillsViewState(null, 'Request failed (500)'), 'error');
  assert.equal(skillsViewState(inventory([], false), ''), 'stopped');
  assert.equal(skillsViewState(inventory([]), ''), 'empty');
  assert.equal(skillsViewState(inventory([skill('codex', 'builtin')]), 'stale refresh error'), 'ready');
});

test('summary counts enabled, disabled, built-in, Waypoint, and added skills without zero categories', () => {
  const inv = inventory([skill('a', 'builtin'), skill('b', 'builtin', { enabled: false }), skill('waypoint-ceo-bridge', 'local', { waypoint: true, locked: true })]);
  assert.equal(skillsSummary(inv), '2 enabled · 1 disabled · 2 built-in · 1 Waypoint');
});

test('summary explicitly accounts for the live built-in plus Waypoint bridge split', () => {
  const skills = Array.from({ length: 53 }, (_, i) => skill(`builtin-${i}`, 'builtin'));
  const inv = inventory([...skills, skill('waypoint-ceo-bridge', 'local', { waypoint: true, locked: true })]);
  assert.equal(skillsSummary(inv), '54 enabled · 0 disabled · 53 built-in · 1 Waypoint');
});

test('disabled skills stay searchable and replaceSkill updates counts for rollback-safe toggles', () => {
  const inv = inventory([skill('notes', 'local', { enabled: false, description: 'write notes' }), skill('codex', 'builtin')]);
  assert.deepEqual(filterSkills(inv.skills, 'disabled', 'notes').map(s => s.name), ['notes']);
  const updated = replaceSkill(inv, { ...inv.skills[0], enabled: true });
  assert.equal(updated.counts.enabled, 2);
  assert.equal(updated.counts.disabled, 0);
});

test('legacy skills inventory without availability fields is read-only instead of treated as disabled', () => {
  const legacy = {
    available: true,
    runtime: { state: 'running', running: true },
    skills: [
      { name: 'waypoint-ceo-bridge', description: 'bridge', category: 'waypoint', source: 'local', waypoint: true },
      { name: 'codex', description: 'coding', category: 'autonomous-ai-agents', source: 'builtin' },
    ],
    counts: { total: 2, builtin: 1, local: 1, hub: 0 },
  } as unknown as HermesSkillInventory;

  assert.equal(skillControlsReady(legacy), false);
  assert.deepEqual(filterSkills(legacy.skills, 'all', '').map(s => s.name), ['codex', 'waypoint-ceo-bridge']);
  assert.deepEqual(filterSkills(legacy.skills, 'disabled', '').map(s => s.name), []);
});
