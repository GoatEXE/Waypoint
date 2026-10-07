import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type HermesSkill, type HermesSkillInventory } from '../api';
import { WorkspaceHead } from '../components/ui';
import {
  filterSkills,
  groupSkills,
  lockedSkillExplanation,
  replaceSkill,
  skillAvailabilityLabel,
  skillControlsReady,
  skillCounts,
  skillsSummary,
  skillsViewState,
  skillSourceLabel,
  updatedSkillFromResponse,
  type SkillAvailabilityFilter,
} from '../skillsModel';

const FILTERS: { id: SkillAvailabilityFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'enabled', label: 'Enabled' },
  { id: 'disabled', label: 'Disabled' },
  { id: 'builtin', label: 'Built-in' },
  { id: 'added', label: 'Added' },
];

export function SkillsView() {
  const [inventory, setInventory] = useState<HermesSkillInventory | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SkillAvailabilityFilter>('all');
  const [selectedName, setSelectedName] = useState('');
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const request = useRef(0);

  const load = async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await api.hermesSkills();
      if (current !== request.current) return;
      setInventory(next);
      setError('');
      setActionError('');
      if (!selectedName && next.skills[0]) setSelectedName(next.skills[0].name);
    } catch (e) {
      if (current === request.current) setError(e instanceof Error ? e.message : 'Could not reach service');
    } finally {
      if (current === request.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const state = skillsViewState(inventory, error);
  const controlsReady = inventory ? skillControlsReady(inventory) : false;
  const effectiveFilter = controlsReady || (filter !== 'enabled' && filter !== 'disabled') ? filter : 'all';
  const availableFilters = controlsReady ? FILTERS : FILTERS.filter(item => item.id !== 'enabled' && item.id !== 'disabled');
  const visibleSkills = useMemo(() => inventory ? filterSkills(inventory.skills, effectiveFilter, query) : [], [inventory, effectiveFilter, query]);
  const groups = useMemo(() => groupSkills(visibleSkills), [visibleSkills]);
  const selectedSkill = useMemo(() => {
    if (!inventory) return null;
    return inventory.skills.find(skill => skill.name === selectedName) || visibleSkills[0] || inventory.skills[0] || null;
  }, [inventory, selectedName, visibleSkills]);
  const counts = inventory && controlsReady ? skillCounts(inventory) : null;

  const toggleSkill = async (skill: HermesSkill, nextEnabled: boolean) => {
    if (!inventory || !controlsReady || skill.locked || pending[skill.name]) return;
    const previous = inventory;
    const optimistic = { ...skill, enabled: nextEnabled };
    setActionError('');
    setPending(current => ({ ...current, [skill.name]: true }));
    setInventory(current => current ? replaceSkill(current, optimistic) : current);
    try {
      const updated = updatedSkillFromResponse(await api.setHermesSkillEnabled(skill.name, nextEnabled));
      setInventory(current => current ? replaceSkill(current, updated) : current);
      setSelectedName(updated.name);
    } catch (e) {
      setInventory(previous);
      setActionError(e instanceof Error ? e.message : 'Could not update skill');
    } finally {
      setPending(current => {
        const { [skill.name]: _done, ...rest } = current;
        return rest;
      });
    }
  };

  return (
    <div className="page skills-page" style={{ maxWidth: 1180, gap: 22 }}>
      <WorkspaceHead title="Skills" lede="Choose which installed Hermes skills the CEO can use. Pod seats are not listed here." />

      <section className="skills-toolbar" aria-label="Skill controls">
        <div className="skills-search-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            className="skills-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search skills"
            aria-label="Search skills"
          />
        </div>
        <div className="skills-filters" aria-label="Skill filters">
          {availableFilters.map(item => (
            <button key={item.id} className={'filter' + (effectiveFilter === item.id ? ' on' : '')} onClick={() => setFilter(item.id)}>
              {item.label}{counts && item.id === 'enabled' ? ` (${counts.enabled})` : item.id === 'disabled' && counts ? ` (${counts.disabled})` : ''}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost sm skills-refresh" disabled={loading} onClick={load}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </section>

      <div className="skills-status-row">
        <span>{state === 'ready' && inventory && controlsReady ? skillsSummary(inventory) : state === 'ready' && inventory ? 'Skill controls are updating. Installed skills are listed below.' : state === 'loading' ? 'Loading skills…' : ''}</span>
        {inventory?.checkedAt && <span>Checked {formatCheckedAt(inventory.checkedAt)}</span>}
      </div>

      {error && <div className="empty" role="alert">Could not load skills: {error}</div>}
      {actionError && <div className="empty" role="alert">Change not saved. The skill list was restored. {actionError}</div>}
      {state === 'ready' && inventory && !controlsReady && <div className="empty" role="status">This backend is still updating its skill controls. You can review the installed skills, but availability, locked status, counts, and Enable or Disable controls are hidden until the service reports them.</div>}
      {state === 'stopped' && <div className="empty">The Hermes CEO is not running. Start it in Settings to see and manage installed skills.</div>}
      {state === 'empty' && <div className="empty">No installed skills found.</div>}
      {state === 'ready' && visibleSkills.length === 0 && <div className="empty">No skills match this search or filter.</div>}

      {state === 'ready' && visibleSkills.length > 0 && (
        <div className="skills-layout">
          <main className="skills-results" aria-label="Installed skills">
            {groups.map(group => (
              <section key={group.id} className="stack" style={{ gap: 10 }}>
                <div className="section-head">
                  <div className="section-title">{group.label}</div>
                  <span className="aside">{group.skills.length} · {controlsReady ? group.note : readOnlyGroupNote(group.id)}</span>
                </div>
                <div className="skills-grid">
                  {group.skills.map(skill => (
                    <SkillCard
                      key={skill.name}
                      skill={skill}
                      active={selectedSkill?.name === skill.name}
                      controlsReady={controlsReady}
                      pending={Boolean(pending[skill.name])}
                      onSelect={() => setSelectedName(skill.name)}
                      onToggle={(enabled) => toggleSkill(skill, enabled)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </main>
          <SkillDetail skill={selectedSkill} controlsReady={controlsReady} pending={selectedSkill ? Boolean(pending[selectedSkill.name]) : false} onToggle={toggleSkill} />
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill, active, controlsReady, pending, onSelect, onToggle }: { skill: HermesSkill; active: boolean; controlsReady: boolean; pending: boolean; onSelect: () => void; onToggle: (enabled: boolean) => void }) {
  return (
    <article className={'skill-card' + (active ? ' active' : '') + (controlsReady && !skill.enabled ? ' disabled-skill' : '')}>
      <button className="skill-card-main" onClick={onSelect} aria-pressed={active}>
        <div className="skill-card-top">
          <span className="skill-mark" aria-hidden="true">{skill.name.slice(0, 2).toUpperCase()}</span>
          <span className="skill-name ellipsis">{skill.name}</span>
          {controlsReady && <span className={'skill-status ' + (skill.enabled ? 'on' : 'off')}>{skillAvailabilityLabel(skill)}</span>}
        </div>
        <p>{skill.description || 'No description provided.'}</p>
        <div className="skill-meta-line">
          <span>{skillSourceLabel(skill)}</span>
          {skill.category && <span>{skill.category}</span>}
        </div>
      </button>
      <div className="skill-card-actions">
        {!controlsReady ? (
          <span className="skill-lock-note">Controls hidden until the service reports availability.</span>
        ) : skill.locked ? (
          <span className="skill-lock-note">{lockedSkillExplanation(skill)}</span>
        ) : (
          <button className="btn btn-ghost sm" disabled={pending} onClick={() => onToggle(!skill.enabled)}>
            {pending ? 'Saving…' : skill.enabled ? 'Disable' : 'Enable'}
          </button>
        )}
      </div>
    </article>
  );
}

function SkillDetail({ skill, controlsReady, pending, onToggle }: { skill: HermesSkill | null; controlsReady: boolean; pending: boolean; onToggle: (skill: HermesSkill, enabled: boolean) => void }) {
  if (!skill) return <aside className="card skill-detail" aria-label="Skill detail"><div className="empty">Select a skill to see details.</div></aside>;
  return (
    <aside className="card skill-detail" aria-label="Skill detail">
      <div className="skill-detail-head">
        <span className="skill-mark large" aria-hidden="true">{skill.name.slice(0, 2).toUpperCase()}</span>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <h2 className="ellipsis">{skill.name}</h2>
          {controlsReady && <span className={'skill-status ' + (skill.enabled ? 'on' : 'off')}>{skillAvailabilityLabel(skill)}</span>}
        </div>
      </div>
      <p className="skill-detail-desc">{skill.description || 'No description provided.'}</p>
      <dl className="skill-detail-list">
        <div><dt>CEO availability</dt><dd>{controlsReady ? (skill.enabled ? 'Available to the CEO' : 'Hidden from the CEO') : 'Not reported by this backend yet'}</dd></div>
        <div><dt>Source</dt><dd>{skillSourceLabel(skill)}</dd></div>
        <div><dt>Category</dt><dd>{skill.category || 'Uncategorized'}</dd></div>
        <div><dt>Control</dt><dd>{controlsReady ? (skill.locked ? 'Required by Waypoint or Hermes' : 'Can be changed here') : 'Read-only until the service update is available'}</dd></div>
      </dl>
      {!controlsReady ? (
        <div className="empty" style={{ padding: 12 }}>Skill controls are updating. This installed skill is shown for review only until the backend reports availability and locked status.</div>
      ) : skill.locked ? (
        <div className="empty" style={{ padding: 12 }}>{lockedSkillExplanation(skill)}</div>
      ) : (
        <button className="btn btn-primary lg" disabled={pending} onClick={() => onToggle(skill, !skill.enabled)}>
          {pending ? 'Saving…' : skill.enabled ? 'Disable skill' : 'Enable skill'}
        </button>
      )}
    </aside>
  );
}

function readOnlyGroupNote(id: string) {
  if (id === 'waypoint') return 'Installed Waypoint bridge skills.';
  if (id === 'builtin') return 'Installed skills that ship with Hermes.';
  return 'Installed local or Skills Hub skills.';
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
