import type { HermesSkill, HermesSkillInventory, HermesSkillUpdateResponse } from './api';

export type SkillsViewState = 'loading' | 'error' | 'stopped' | 'empty' | 'ready';
export type SkillGroupId = 'waypoint' | 'added' | 'builtin';
export type SkillAvailabilityFilter = 'all' | 'enabled' | 'disabled' | 'builtin' | 'added';
export interface SkillGroup { id: SkillGroupId; label: string; note: string; skills: HermesSkill[] }

const GROUPS: Omit<SkillGroup, 'skills'>[] = [
  { id: 'waypoint', label: 'Waypoint', note: 'Required bridge skills. These stay available for the CEO.' },
  { id: 'added', label: 'Added', note: 'Skills installed in the CEO home or from the Skills Hub.' },
  { id: 'builtin', label: 'Built-in', note: 'Skills that ship with Hermes. Turn off anything the CEO should not use.' },
];

export function isWaypointSkill(skill: HermesSkill): boolean {
  return Boolean(skill.waypoint || skill.name === 'waypoint-ceo-bridge' || skill.category?.toLowerCase() === 'waypoint');
}

export function skillGroupId(skill: HermesSkill): SkillGroupId {
  if (isWaypointSkill(skill)) return 'waypoint';
  return skill.source === 'builtin' ? 'builtin' : 'added';
}

export function groupSkills(skills: HermesSkill[]): SkillGroup[] {
  return GROUPS
    .map(group => ({ ...group, skills: skills.filter(skill => skillGroupId(skill) === group.id) }))
    .filter(group => group.skills.length > 0);
}

export function skillsViewState(inventory: HermesSkillInventory | null, error: string): SkillsViewState {
  if (error && !inventory) return 'error';
  if (!inventory) return 'loading';
  if (!inventory.available) return 'stopped';
  return inventory.skills.length ? 'ready' : 'empty';
}

export function skillControlsReady(inventory: HermesSkillInventory): boolean {
  return typeof inventory.counts.enabled === 'number'
    && inventory.skills.every(skill => typeof skill.enabled === 'boolean' && typeof skill.locked === 'boolean');
}

export function skillCounts(inventory: HermesSkillInventory) {
  const total = inventory.counts.total ?? inventory.skills.length;
  const enabled = inventory.counts.enabled ?? inventory.skills.filter(skill => skill.enabled).length;
  const disabled = inventory.counts.disabled ?? Math.max(0, total - enabled);
  const builtin = inventory.counts.builtin ?? inventory.skills.filter(skill => skill.source === 'builtin').length;
  const waypoint = inventory.counts.waypoint ?? inventory.skills.filter(isWaypointSkill).length;
  const added = inventory.counts.added ?? inventory.skills.filter(skill => skillGroupId(skill) === 'added').length;
  return { total, enabled, disabled, builtin, waypoint, added };
}

export function skillsSummary(inventory: HermesSkillInventory): string {
  const { enabled, disabled, builtin, waypoint, added } = skillCounts(inventory);
  const parts = [`${enabled} enabled`, `${disabled} disabled`];
  if (builtin) parts.push(`${builtin} built-in`);
  if (waypoint) parts.push(`${waypoint} Waypoint`);
  if (added) parts.push(`${added} added`);
  return parts.join(' · ');
}

export function skillSourceLabel(skill: HermesSkill): string {
  if (isWaypointSkill(skill)) return 'Waypoint';
  if (skill.source === 'builtin') return 'Built-in';
  if (skill.source === 'hub') return 'Skills Hub';
  if (skill.source === 'local') return 'Local';
  return skill.source;
}

export function skillAvailabilityLabel(skill: HermesSkill): string {
  if (skill.locked) return skill.enabled ? 'Required' : 'Locked';
  return skill.enabled ? 'Enabled' : 'Disabled';
}

export function lockedSkillExplanation(skill: HermesSkill): string {
  if (isWaypointSkill(skill)) return 'Waypoint uses this bridge to talk to the CEO, so it stays available.';
  return 'Hermes marks this skill as required, so it cannot be changed here.';
}

export function matchesSkillSearch(skill: HermesSkill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [skill.name, skill.description, skill.category, skill.source, skillSourceLabel(skill)]
    .filter(Boolean)
    .some(value => String(value).toLowerCase().includes(q));
}

export function filterSkills(skills: HermesSkill[], filter: SkillAvailabilityFilter, query: string): HermesSkill[] {
  return skills
    .filter(skill => matchesSkillSearch(skill, query))
    .filter(skill => {
      if (filter === 'enabled') return skill.enabled === true;
      if (filter === 'disabled') return skill.enabled === false;
      if (filter === 'builtin') return skillGroupId(skill) === 'builtin';
      if (filter === 'added') return skillGroupId(skill) === 'added' || skillGroupId(skill) === 'waypoint';
      return true;
    })
    .sort((a, b) => {
      const aHasEnabled = typeof a.enabled === 'boolean';
      const bHasEnabled = typeof b.enabled === 'boolean';
      if (aHasEnabled && bHasEnabled) return Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
}

export function updatedSkillFromResponse(response: HermesSkillUpdateResponse): HermesSkill {
  return 'skill' in response ? response.skill : response;
}

export function replaceSkill(inventory: HermesSkillInventory, updated: HermesSkill): HermesSkillInventory {
  const skills = inventory.skills.map(skill => skill.name === updated.name ? { ...skill, ...updated } : skill);
  const enabled = skills.filter(skill => skill.enabled).length;
  const total = skills.length;
  return {
    ...inventory,
    skills,
    counts: {
      ...inventory.counts,
      total,
      enabled,
      disabled: total - enabled,
      builtin: skills.filter(skill => skill.source === 'builtin').length,
      local: skills.filter(skill => skill.source === 'local').length,
      hub: skills.filter(skill => skill.source === 'hub').length,
      waypoint: skills.filter(isWaypointSkill).length,
      added: skills.filter(skill => skillGroupId(skill) === 'added').length,
    },
  };
}
