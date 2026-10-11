import { useEffect, useState } from 'react';
import { api, type HermesModelCatalog, type SeatProfile } from '../api';
import { PROVIDERS } from '../providerConfig';
import { errorText } from '../runtimeHealth';
import { useStore } from '../store';

type Draft = Omit<SeatProfile, 'id'>;

function changes(saved: Draft, draft: Draft): Partial<Draft> {
  const out: Partial<Draft> = {};
  if (draft.description.trim() !== saved.description) out.description = draft.description.trim();
  if (draft.soul !== saved.soul) out.soul = draft.soul;
  if (draft.memory !== saved.memory) out.memory = draft.memory;
  if (draft.user !== saved.user) out.user = draft.user;
  if (draft.model.provider !== saved.model.provider || draft.model.default !== saved.model.default) out.model = draft.model;
  return out;
}

function TextSection({ label, hint, value, rows, disabled, onChange }: { label: string; hint: string; value: string; rows: number; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="field"><span className="field-label">{label}</span>
      <span className="field-hint">{hint}</span>
      <textarea className="input mono" style={{ fontSize: 12.5, lineHeight: 1.5 }} rows={rows} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

export function SeatProfileEditor({ id }: { id: string }) {
  const { flash } = useStore();
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catalog, setCatalog] = useState<HermesModelCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setSaved(null); setDraft(null); setError('');
    api.seatProfile(id).then(p => { if (active) { setSaved(p); setDraft(p); } }).catch(e => { if (active) setError(errorText(e)); });
    api.hermesModelCatalog().then(c => { if (active) setCatalog(c); }).catch(() => undefined);
    return () => { active = false; };
  }, [id]);

  if (!draft || !saved) return error ? <div role="alert" className="form-error">{error}</div> : <div className="empty" role="status">Loading profile…</div>;
  const patch = changes(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => d && { ...d, [key]: value });
  const models = catalog?.providers.find(p => p.id === draft.model.provider)?.models.map(m => m.id) || [];
  const modelOptions = draft.model.default && !models.includes(draft.model.default) ? [draft.model.default, ...models] : models;
  const save = async () => {
    setBusy(true); setError('');
    try { const next = await api.updateSeatProfile(id, patch); setSaved(next); setDraft(next); flash(`Saved ${id}`); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card stack" style={{ padding: 16, gap: 16 }} aria-label="Seat profile">
      <label className="field"><span className="field-label">Description</span>
        <span className="field-hint">What this seat does. The CEO uses it to pick who gets a task.</span>
        <textarea className="input" rows={2} value={draft.description} maxLength={200} disabled={busy} onChange={e => set('description', e.target.value)} />
      </label>
      <div className="task-field-grid">
        <label className="field"><span className="field-label">Provider</span>
          <select className="input" value={draft.model.provider} disabled={busy} onChange={e => {
            const provider = e.target.value;
            const fallback = catalog?.providers.find(p => p.id === provider)?.default || '';
            set('model', { provider, default: fallback });
          }}>
            {!PROVIDERS.some(p => p.id === draft.model.provider) && <option value={draft.model.provider}>{draft.model.provider || 'Not set'}</option>}
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Model</span>
          <select className="input mono" value={draft.model.default} disabled={busy || !modelOptions.length} onChange={e => set('model', { ...draft.model, default: e.target.value })}>
            {!modelOptions.length && <option value={draft.model.default}>{draft.model.default || 'Loading models…'}</option>}
            {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>
      <TextSection label="Soul" hint="The seat's personality and standing instructions (SOUL.md)." rows={10} value={draft.soul} disabled={busy} onChange={v => set('soul', v)} />
      <TextSection label="Memory" hint="What the seat has learned and saved for itself (MEMORY.md)." rows={6} value={draft.memory} disabled={busy} onChange={v => set('memory', v)} />
      <TextSection label="About you" hint="What the seat remembers about you (USER.md)." rows={6} value={draft.user} disabled={busy} onChange={v => set('user', v)} />
      {error && <div role="alert" className="form-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, position: 'sticky', bottom: 0, paddingTop: 8, background: 'var(--surface)' }}>
        <button className="btn btn-primary" disabled={!dirty || busy || !draft.description.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        {dirty && <button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(saved)}>Discard</button>}
      </div>
    </section>
  );
}
