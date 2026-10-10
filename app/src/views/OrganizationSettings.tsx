import { useEffect, useRef, useState } from 'react';
import type { OrganizationInput } from '../api';
import { useStore } from '../store';
import { KEY_RE, cleanKey, readLogo } from '../orgModel';
import { errorText } from '../runtimeHealth';

export function OrganizationSettings() {
  const { state, saveOrganization, flash } = useStore();
  const org = state.org.organization;
  const [name, setName] = useState(org?.name || '');
  const [key, setKey] = useState(org?.key || '');
  const [ceoName, setCeoName] = useState(org?.ceoName || 'CEO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(org?.name || '');
    setKey(org?.key || '');
    setCeoName(org?.ceoName || 'CEO');
  }, [org?.name, org?.key, org?.ceoName]);

  const save = async (input: OrganizationInput, done: string) => {
    setBusy(true); setError('');
    try {
      await saveOrganization(input);
      flash(done);
    } catch (e) {
      setError(errorText(e));
    } finally { setBusy(false); }
  };

  const pickLogo = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try { await save({ logo: await readLogo(file) }, 'Organization photo updated'); }
    catch (e) { setError(errorText(e)); }
  };

  const dirty = name.trim() !== (org?.name || '') || key !== (org?.key || '') || ceoName.trim() !== (org?.ceoName || 'CEO');
  const valid = Boolean(name.trim() && ceoName.trim() && KEY_RE.test(key));

  return (
    <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="Organization">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {org?.logo ? <img className="org-logo" src={org.logo} alt="Organization photo" /> : <div className="org-logo">{(org?.name || 'W').slice(0, 1).toUpperCase()}</div>}
        <div className="stack" style={{ gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Organization</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost sm" disabled={busy} onClick={() => fileRef.current?.click()}>{org?.logo ? 'Change photo' : 'Upload photo'}</button>
            {org?.logo && <button className="btn btn-ghost sm" disabled={busy} onClick={() => void save({ logo: null }, 'Organization photo removed')}>Remove</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => void pickLogo(e.target.files?.[0])} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={name} maxLength={80} disabled={busy} onChange={e => setName(e.target.value)} />
        </label>
        <label className="field"><span className="field-label">Task prefix</span>
          <input className="input mono" value={key} disabled={busy} onChange={e => setKey(cleanKey(e.target.value))} />
        </label>
        <label className="field"><span className="field-label">CEO name</span>
          <input className="input" value={ceoName} maxLength={40} disabled={busy} onChange={e => setCeoName(e.target.value)} />
        </label>
      </div>
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--text)' }}>{error}</div>}
      <div>
        <button className="btn btn-primary" disabled={busy || !dirty || !valid} onClick={() => void save({ name: name.trim(), key, ceoName: ceoName.trim() }, 'Organization saved')}>Save organization</button>
      </div>
    </section>
  );
}
