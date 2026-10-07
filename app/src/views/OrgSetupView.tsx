import { useEffect, useState } from 'react';
import { api, type HermesModelCatalog } from '../api';
import { PROVIDERS, RECOMMENDED_MODELS } from '../providerConfig';
import { DEFAULTS, defaultModelForProvider, modelFromStatus, type Provider } from '../settingsModel';
import { useStore } from '../store';
import { KEY_RE, cleanKey, deriveOrgKey } from '../orgModel';

const STEPS = ['Organization', 'CEO', 'Model'];

export function OrgSetupView() {
  const { saveOrganization, flash } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [ceoName, setCeoName] = useState('CEO');
  const [provider, setProvider] = useState<Provider>('openai-codex');
  const [model, setModel] = useState(DEFAULTS['openai-codex'].default);
  const [catalog, setCatalog] = useState<HermesModelCatalog | null>(null);
  const [saved, setSaved] = useState<{ provider: Provider; model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.hermesModelCatalog().then(setCatalog).catch(() => setCatalog(null));
    api.hermesStatus().then(status => {
      const current = modelFromStatus(status);
      if (!current) return;
      setProvider(current.provider); setModel(current.default); setSaved({ provider: current.provider, model: current.default });
    }).catch(() => undefined);
  }, []);

  const shownKey = keyEdited ? key : deriveOrgKey(name);
  const catalogProvider = catalog?.providers.find(p => p.id === provider);
  const listed = catalogProvider?.models || [];
  const ids = RECOMMENDED_MODELS[provider].includes(model) ? RECOMMENDED_MODELS[provider] : [model, ...RECOMMENDED_MODELS[provider]];
  const models = ids.map(id => listed.find(m => m.id === id) || { id, name: id });

  const pickProvider = (next: Provider) => {
    setProvider(next);
    setModel(defaultModelForProvider(next, catalog?.providers.find(p => p.id === next), RECOMMENDED_MODELS[next]));
  };

  const ok = step === 0 ? name.trim() && KEY_RE.test(shownKey) : step === 1 ? ceoName.trim() : true;

  const finish = async (withModel: boolean) => {
    setBusy(true); setError('');
    try {
      await saveOrganization({ name: name.trim(), key: shownKey, ceoName: ceoName.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the organization');
      setBusy(false);
      return;
    }
    if (!withModel || (saved?.provider === provider && saved.model === model)) return;
    const fallback = DEFAULTS[provider];
    try {
      await api.saveModel({ provider, default: model, api_mode: catalogProvider?.api_mode || fallback.api_mode, base_url: '' });
    } catch (e) {
      flash(`Model not saved: ${e instanceof Error ? e.message : 'unavailable'}. Set it in Settings.`);
    }
  };

  const next = () => {
    if (!ok || busy) return;
    if (step < STEPS.length - 1) setStep(step + 1);
    else void finish(true);
  };

  return (
    <div className="setup">
      <form className="setup-card stack" onSubmit={e => { e.preventDefault(); next(); }}>
        <div className="setup-steps">
          {STEPS.map((label, i) => <span key={label} className={'setup-step' + (i === step ? ' on' : i < step ? ' done' : '')}>{label}</span>)}
        </div>

        {step === 0 && <>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">WELCOME TO WAYPOINT</div>
            <h1 className="h1">Name your organization</h1>
            <p className="setup-lede">This is the home for your agents, projects, and tasks.</p>
          </div>
          <label className="field"><span className="field-label">Organization name</span>
            <input className="input" autoFocus value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Acme Robotics" />
          </label>
          <label className="field"><span className="field-label">Task prefix</span>
            <input className="input mono" value={shownKey} onChange={e => { setKeyEdited(true); setKey(cleanKey(e.target.value)); }} style={{ width: 120 }} />
            <span className="setup-hint">Task IDs will look like {shownKey || 'KEY'}-1, {shownKey || 'KEY'}-2.</span>
          </label>
        </>}

        {step === 1 && <>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">YOUR CHIEF EXECUTIVE</div>
            <h1 className="h1">Name your CEO agent</h1>
            <p className="setup-lede">The CEO takes your requests, staffs pods, and reports back.</p>
          </div>
          <label className="field"><span className="field-label">CEO name</span>
            <input className="input" autoFocus value={ceoName} maxLength={40} onChange={e => setCeoName(e.target.value)} />
          </label>
        </>}

        {step === 2 && <>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">PREFERRED MODEL</div>
            <h1 className="h1">Pick {ceoName.trim() || 'the CEO'}'s model</h1>
            <p className="setup-lede">New pods use this model unless you choose another. You can sign in to the provider in Connectors.</p>
          </div>
          <div className="chips">
            {PROVIDERS.map(p => <button key={p.id} type="button" className={'chip' + (provider === p.id ? ' on' : '')} aria-pressed={provider === p.id} onClick={() => pickProvider(p.id)}>{p.name}</button>)}
          </div>
          <div className="chips">
            {models.map(m => <button key={m.id} type="button" className={'chip mono' + (model === m.id ? ' on' : '')} aria-pressed={model === m.id} onClick={() => setModel(m.id)}>{m.name || m.id}</button>)}
          </div>
        </>}

        {error && <div role="alert" className="setup-hint" style={{ color: 'var(--text)' }}>{error}</div>}

        <div className="setup-actions">
          {step > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>}
          {step === 2 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void finish(false)} style={{ marginLeft: 'auto' }}>Skip for now</button>}
          <button type="submit" className="btn btn-primary lg" disabled={!ok || busy} style={step === 2 ? undefined : { marginLeft: 'auto' }}>
            {step < 2 ? 'Continue' : busy ? 'Saving…' : 'Finish setup'}
          </button>
        </div>
      </form>
    </div>
  );
}
