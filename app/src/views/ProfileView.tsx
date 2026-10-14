import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type UsageReport, type UserMemory } from '../api';
import { useStore } from '../store';
import { errorText } from '../runtimeHealth';
import { USER_ABOUT_MAX, USER_NAME_MAX, initialsOf, userNameOf, userNameOk } from '../userModel';
import { ceoNameOf } from '../orgModel';
import { barsFor, compactNumber, costLine, dayDate, memoryUsed, todayIndex, totalsFor, type UsageBar, type UsageRange } from '../usageModel';

type UsageMetric = 'tasks' | 'tokens';

const RANGES: { id: UsageRange; label: string }[] = [{ id: 7, label: '7 days' }, { id: 30, label: '30 days' }, { id: 'all', label: 'All time' }];
const fmtShort = (day: number) => dayDate(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDay = (day: number) => dayDate(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

function YouSection() {
  const { state, saveUser, flash } = useStore();
  const user = state.user.user;
  const [name, setName] = useState(user?.name || '');
  const [about, setAbout] = useState(user?.about || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setName(user?.name || ''); setAbout(user?.about || ''); }, [user?.name, user?.about]);
  const dirty = name.trim() !== (user?.name || '') || about.trim() !== (user?.about || '');
  const save = async () => {
    setBusy(true); setError('');
    try { await saveUser({ name: name.trim(), about: about.trim() }); flash('Profile saved'); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="You">
      <h2 className="section-title" style={{ margin: 0 }}>You</h2>
      <div className="profile-fields">
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={name} maxLength={USER_NAME_MAX} disabled={busy} onChange={e => setName(e.target.value)} />
        </label>
        <label className="field"><span className="field-label">About you</span>
          <input className="input" value={about} maxLength={USER_ABOUT_MAX} disabled={busy} onChange={e => setAbout(e.target.value)} placeholder="One sentence" />
        </label>
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
      <div><button className="btn btn-primary" disabled={busy || !dirty || !userNameOk(name)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></div>
    </section>
  );
}

function UsageChart({ bars, metric }: { bars: UsageBar[]; metric: UsageMetric }) {
  const value = (b: UsageBar) => metric === 'tasks' ? b.tasks : b.tokens;
  const max = Math.max(1, ...bars.map(value));
  const unit = metric === 'tasks' ? 'tasks done' : 'tokens';
  const label = (b: UsageBar) => b.start === b.end ? fmtDay(b.start) : `${fmtShort(b.start)} – ${fmtShort(b.end)}`;
  const every = Math.ceil(bars.length / 8);
  return (
    <div className="usage-chart" role="img" aria-label={`${unit} over the selected range`}>
      <div className="usage-chart-scale"><span>{metric === 'tasks' ? max : compactNumber(max)}</span><span>0</span></div>
      <div className="usage-chart-body">
        <div className="usage-chart-bars">
          {bars.map(b => (
            <div key={b.start} className="usage-chart-col" title={`${label(b)}: ${value(b).toLocaleString()} ${unit}`}>
              <span className={'usage-chart-bar'} style={{ height: `${value(b) ? Math.max(3, (value(b) / max) * 100) : 0}%` }} />
            </div>
          ))}
        </div>
        <div className="usage-chart-axis">
          {bars.map((b, i) => <span key={b.start}>{i % every === 0 ? fmtShort(b.start) : ''}</span>)}
        </div>
      </div>
    </div>
  );
}

function ActivitySection() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState('');
  const [metric, setMetric] = useState<UsageMetric>('tokens');
  const [range, setRange] = useState<UsageRange>(30);
  const today = todayIndex();
  const load = useCallback(() => {
    setError('');
    api.userUsage(new Date().getTimezoneOffset()).then(setReport).catch(e => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);
  const bars = useMemo(() => report ? barsFor(report.days, today, range) : [], [report, today, range]);
  const totals = useMemo(() => report ? totalsFor(report.days, today, range) : null, [report, today, range]);

  if (error) return <section className="card stack" style={{ padding: 16, gap: 10 }} aria-label="Usage"><h2 className="section-title" style={{ margin: 0 }}>Usage</h2><div role="alert" className="form-error">{error}</div><div><button className="btn btn-ghost sm" onClick={load}>Try again</button></div></section>;
  if (!report || !totals) return <section className="card" style={{ padding: 16 }} aria-label="Usage"><div className="empty" role="status">Loading usage…</div></section>;
  if (!report.available) return <section className="card stack" style={{ padding: 16, gap: 8 }} aria-label="Usage"><h2 className="section-title" style={{ margin: 0 }}>Usage</h2><p className="field-hint" style={{ margin: 0 }}>Start the CEO to see tasks and token usage.</p></section>;

  const cost = costLine(report, totals);

  return (
    <section className="card stack" style={{ padding: 16, gap: 16 }} aria-label="Usage">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Usage</h2>
        <div className="segmented" style={{ marginLeft: 'auto' }} role="radiogroup" aria-label="Range">
          {RANGES.map(r => <button key={r.id} role="radio" aria-checked={range === r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>{r.label}</button>)}
        </div>
      </div>
      <div className="usage-stats" style={{ gridTemplateColumns: `repeat(${report.billing.apiKey ? 4 : 3}, minmax(0, 1fr))` }}>
        <div className="usage-stat"><span className="usage-stat-value" title={totals.tokens.toLocaleString()}>{compactNumber(totals.tokens)}</span><span className="usage-stat-label">Tokens</span></div>
        <div className="usage-stat"><span className="usage-stat-value">{totals.tasks.toLocaleString()}</span><span className="usage-stat-label">Tasks done</span></div>
        <div className="usage-stat"><span className="usage-stat-value">{totals.sessions.toLocaleString()}</span><span className="usage-stat-label">Agent runs</span></div>
        {report.billing.apiKey && <div className="usage-stat"><span className="usage-stat-value">{totals.cost > 0 ? (totals.cost < 0.01 ? '<$0.01' : `$${totals.cost.toFixed(totals.cost < 10 ? 2 : 0)}`) : 'n/a'}</span><span className="usage-stat-label">API-key cost</span></div>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="segmented" style={{ alignSelf: 'flex-start' }} role="radiogroup" aria-label="Chart">
          <button role="radio" aria-checked={metric === 'tokens'} className={metric === 'tokens' ? 'on' : ''} onClick={() => setMetric('tokens')}>Tokens</button>
          <button role="radio" aria-checked={metric === 'tasks'} className={metric === 'tasks' ? 'on' : ''} onClick={() => setMetric('tasks')}>Tasks</button>
        </div>
        <UsageChart bars={bars} metric={metric} />
      </div>
      {totals.tokens > 0 && (
        <div className="usage-break">
          <span>{compactNumber(totals.input)} in</span><span>{compactNumber(totals.output)} out</span><span>{compactNumber(totals.cache)} cached</span>
        </div>
      )}
      {totals.agents.length > 0 && (
        <div className="stack" style={{ gap: 6 }} aria-label="Tokens by agent">
          {totals.agents.map(a => (
            <div key={a.id} className="usage-agent">
              <span className="mono ellipsis" style={{ width: 110 }}>{a.id}</span>
              <span className="usage-bar"><span style={{ width: `${Math.max(2, (a.tokens / totals.agents[0].tokens) * 100)}%` }} /></span>
              <span className="mono" style={{ width: 56, textAlign: 'right' }}>{compactNumber(a.tokens)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="field-hint" style={{ margin: 0 }}>
        {cost ? `${cost}. ` : ''}
        {report.billing.subscription ? 'Subscription sign-ins are covered by your plan and show no cost.' : !report.billing.apiKey ? 'Nothing billed to API keys yet.' : ''}
      </p>
      {report.unreadable.length > 0 && <p className="field-hint" style={{ margin: 0 }}>Couldn't read: {report.unreadable.join(', ')}.</p>}
    </section>
  );
}

function MemorySection() {
  const { state, flash } = useStore();
  const ceo = ceoNameOf(state.org.organization);
  const [memory, setMemory] = useState<UserMemory | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api.userMemory().then(m => { setMemory(m); setDraft(m.entries); }).catch(e => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  if (!memory) return <section className="card stack" style={{ padding: 16, gap: 10 }} aria-label={`What ${ceo} knows about you`}>{error ? <><div role="alert" className="form-error">{error}</div><div><button className="btn btn-ghost sm" onClick={load}>Try again</button></div></> : <div className="empty" role="status">Loading…</div>}</section>;

  const cleaned = draft.map(e => e.trim()).filter(Boolean);
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(memory.entries);
  const used = memoryUsed(draft);
  const over = memory.limit > 0 && used > memory.limit;
  const save = async () => {
    setBusy(true); setError('');
    try { const next = await api.saveUserMemory(cleaned, memory.entries); setMemory(next); setDraft(next.entries); flash('Saved what ' + ceo + ' knows about you'); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card stack" style={{ padding: 16, gap: 12 }} aria-label={`What ${ceo} knows about you`}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="section-title" style={{ margin: 0 }}>What {ceo} knows about you</h2>
        {memory.available && <span className={'mono field-hint' + (over ? ' over' : '')} style={{ margin: '0 0 0 auto' }}>{used.toLocaleString()} / {memory.limit.toLocaleString()} chars</span>}
      </div>
      {!memory.available ? <p className="field-hint" style={{ margin: 0 }}>Start the CEO to see and edit this.</p> : <>
        <p className="field-hint" style={{ margin: 0 }}>{ceo} keeps these notes in USER.md and reads them in every conversation. It also adds to them as it learns.{!memory.enabled && ' Profile memory is turned off in Hermes, so these are saved but not read.'}</p>
        <div className="stack" style={{ gap: 6 }}>
          {draft.length === 0 && <div className="empty">Nothing yet.</div>}
          {draft.map((entry, i) => (
            <div key={i} className="memory-entry">
              <textarea className="input" rows={Math.min(6, Math.max(1, Math.ceil(entry.length / 60)))} value={entry} disabled={busy} aria-label={`Note ${i + 1}`} onChange={e => setDraft(d => d.map((x, j) => j === i ? e.target.value : x))} />
              <button className="btn btn-ghost sm" disabled={busy} aria-label={`Remove note ${i + 1}`} title="Remove" onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
        {error && <div role="alert" className="form-error">{error}</div>}
        {over && <div role="alert" className="form-error">That's {used - memory.limit} characters over the limit. Shorten or remove a note.</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(d => [...d, ''])}>Add note</button>
          <span style={{ flex: 1 }} />
          {dirty && <button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(memory.entries)}>Discard</button>}
          <button className="btn btn-primary" disabled={busy || !dirty || over} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </>}
    </section>
  );
}

export function ProfileView() {
  const { state } = useStore();
  const user = state.user.user;
  const org = state.org.organization;
  return (
    <div className="page stack" style={{ maxWidth: 920, gap: 20 }}>
      <div className="profile-head">
        <div className="profile-avatar">{initialsOf(userNameOf(user))}</div>
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <div className="eyebrow">PROFILE{org?.name ? ` · ${org.name.toUpperCase()}` : ''}</div>
          <h1 className="h1 ellipsis">{userNameOf(user)}</h1>
          {user?.about && <p className="lede" style={{ fontSize: 13.5 }}>{user.about}</p>}
        </div>
      </div>
      <ActivitySection />
      <MemorySection />
      <YouSection />
    </div>
  );
}
