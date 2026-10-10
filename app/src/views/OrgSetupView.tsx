import { useEffect, useState } from 'react';
import { api, type HermesModelCatalog } from '../api';
import { RECOMMENDED_MODELS } from '../providerConfig';
import { DEFAULTS, defaultModelForProvider, type Provider } from '../settingsModel';
import { useStore } from '../store';
import { KEY_RE, cleanKey, deriveOrgKey } from '../orgModel';
import { ProviderConnect } from '../components/ProviderConnect';
import { Reveal } from '../components/Reveal';
import { errorText } from '../runtimeHealth';

const STEPS = ['Organization', 'CEO', 'Connect', 'Team'];
export const ONBOARDING_KICKOFF = "Let's get me onboarded. Use your waypoint-onboarding skill.";

export function OrgSetupView() {
  const { saveOrganization, flash, setCeoThread, sendCeoMessage } = useStore();
  const [step, setStepRaw] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const setStep = (target: number) => { setDirection(target < step ? 'back' : 'forward'); setStepRaw(target); };
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [ceoName, setCeoName] = useState('CEO');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [catalog, setCatalog] = useState<HermesModelCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.hermesModelCatalog().then(setCatalog).catch(() => setCatalog(null)); }, []);

  const shownKey = keyEdited ? key : deriveOrgKey(name);
  const ok = step === 0 ? name.trim() && KEY_RE.test(shownKey) : step === 1 ? ceoName.trim() : Boolean(provider);

  const finish = async (onboard: boolean) => {
    setBusy(true); setError('');
    try {
      await saveOrganization({ name: name.trim(), key: shownKey, ceoName: ceoName.trim() });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      return;
    }
    if (provider) {
      const fresh = await api.hermesModelCatalog(provider, { refresh: true }).catch(() => catalog);
      const catalogProvider = fresh?.providers.find(p => p.id === provider);
      try {
        await api.saveModel({ provider, default: defaultModelForProvider(provider, catalogProvider, RECOMMENDED_MODELS[provider]), api_mode: catalogProvider?.api_mode || DEFAULTS[provider].api_mode, base_url: '' });
      } catch (e) {
        flash(`Model not saved: ${errorText(e)}`);
      }
    }
    if (!onboard) return;
    setCeoThread('general');
    void sendCeoMessage(ONBOARDING_KICKOFF, true);
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

        {step === 0 && <div key={0} className={'setup-body ' + direction}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">WELCOME TO WAYPOINT</div>
            <h1 className="h1">Name your organization</h1>
          </div>
          <label className="field"><span className="field-label">Organization name</span>
            <input className="input" autoFocus value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Acme Robotics" />
          </label>
          <label className="field"><span className="field-label">Task prefix</span>
            <input className="input mono" value={shownKey} onChange={e => { setKeyEdited(true); setKey(cleanKey(e.target.value)); }} style={{ width: 120 }} />
          </label>
        </div>}

        {step === 1 && <div key={1} className={'setup-body ' + direction}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">YOUR CHIEF EXECUTIVE</div>
            <h1 className="h1">Name your CEO agent</h1>
          </div>
          <label className="field"><span className="field-label">CEO name</span>
            <input className="input" autoFocus value={ceoName} maxLength={40} onChange={e => setCeoName(e.target.value)} />
          </label>
        </div>}

        {step === 2 && <div key={2} className={'setup-body ' + direction}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">CONNECT</div>
            <h1 className="h1">Connect {ceoName.trim() || 'the CEO'} to a model</h1>
          </div>
          <ProviderConnect onChange={setProvider} />
        </div>}

        {step === 3 && <div key={3} className={'setup-body ' + direction}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">YOUR TEAM</div>
            <h1 className="h1">Build your team with {ceoName.trim() || 'the CEO'}</h1>
          </div>
          <p className="setup-hint">{ceoName.trim() || 'The CEO'} interviews you about what you're working on, then proposes a mission and the seats to hire. Skip goes straight to the workspace; you can onboard later from Organization.</p>
          {!provider && <div className="setup-hint" role="status">Onboarding needs a connected model. <button type="button" className="link-btn" onClick={() => setStep(2)}>Connect a model first →</button></div>}
        </div>}

        <Reveal show={Boolean(error)}><div role="alert" className="setup-hint" style={{ color: 'var(--text)' }}>{error}</div></Reveal>

        <div className="setup-actions">
          {step > 0 && <button type="button" className="btn btn-ghost pop-in" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>}
          {step === 2 && <button type="button" className="btn btn-ghost pop-in" disabled={busy} onClick={() => { setProvider(null); setStep(3); }} style={{ marginLeft: 'auto' }}>Skip for now</button>}
          {step === 3 && <button type="button" className="btn btn-ghost pop-in" disabled={busy} onClick={() => void finish(false)} style={{ marginLeft: 'auto' }}>Skip</button>}
          <button type="submit" className="btn btn-primary lg" disabled={!ok || busy} style={step >= 2 ? undefined : { marginLeft: 'auto' }}>
            {step < 3 ? 'Continue' : busy ? 'Saving…' : 'Start onboarding'}
          </button>
        </div>
      </form>
    </div>
  );
}
