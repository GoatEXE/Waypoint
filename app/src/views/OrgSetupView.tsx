import { useEffect, useState } from 'react';
import { api, type HermesModelCatalog } from '../api';
import { RECOMMENDED_MODELS } from '../providerConfig';
import { DEFAULTS, defaultModelForProvider, type Provider } from '../settingsModel';
import { useStore } from '../store';
import { KEY_RE, cleanKey, deriveOrgKey } from '../orgModel';
import { ProviderConnect } from '../components/ProviderConnect';
import { Reveal } from '../components/Reveal';
import { errorText } from '../runtimeHealth';
import { USER_ABOUT_MAX, USER_NAME_MAX, userNameOk } from '../userModel';

const STEPS = ['You', 'Organization', 'CEO', 'Connect', 'Team'];
export const ONBOARDING_KICKOFF = "Let's get me onboarded. Use your waypoint-onboarding skill.";

function UserFields({ name, about, onName, onAbout }: { name: string; about: string; onName: (v: string) => void; onAbout: (v: string) => void }) {
  return <>
    <label className="field"><span className="field-label">Your name</span>
      <input className="input" autoFocus required value={name} maxLength={USER_NAME_MAX} onChange={e => onName(e.target.value)} placeholder="Ada Lovelace" />
    </label>
    <label className="field"><span className="field-label">About you <span className="c-faint">(optional)</span></span>
      <input className="input" value={about} maxLength={USER_ABOUT_MAX} onChange={e => onAbout(e.target.value)} placeholder="One sentence: what you do and what you want help with" />
    </label>
  </>;
}

export function UserSetupView() {
  const { saveUser, state } = useStore();
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ceoName = state.org.organization?.ceoName || 'The CEO';
  const save = async () => {
    if (!userNameOk(name) || busy) return;
    setBusy(true); setError('');
    try { await saveUser({ name: name.trim(), about: about.trim() }); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <div className="setup">
      <form className="setup-card stack" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="setup-body forward">
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">ONE MORE THING</div>
            <h1 className="h1">What should we call you?</h1>
            <p className="setup-hint" style={{ margin: 0 }}>{ceoName} keeps this in what it knows about you.</p>
          </div>
          <UserFields name={name} about={about} onName={setName} onAbout={setAbout} />
        </div>
        <Reveal show={Boolean(error)}><div role="alert" className="setup-hint" style={{ color: 'var(--text)' }}>{error}</div></Reveal>
        <div className="setup-actions">
          <button type="submit" className="btn btn-primary lg" disabled={!userNameOk(name) || busy} style={{ marginLeft: 'auto' }}>{busy ? 'Saving…' : 'Continue'}</button>
        </div>
      </form>
    </div>
  );
}

export function OrgSetupView() {
  const { saveOrganization, saveUser, flash, setCeoThread, sendCeoMessage } = useStore();
  const [step, setStepRaw] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const setStep = (target: number) => { setDirection(target < step ? 'back' : 'forward'); setStepRaw(target); };
  const [userName, setUserName] = useState('');
  const [about, setAbout] = useState('');
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
  const ok = step === 0 ? userNameOk(userName) : step === 1 ? name.trim() && KEY_RE.test(shownKey) : step === 2 ? ceoName.trim() : Boolean(provider);

  const finish = async (onboard: boolean) => {
    setBusy(true); setError('');
    try {
      await saveUser({ name: userName.trim(), about: about.trim() });
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
            <h1 className="h1">What should we call you?</h1>
          </div>
          <UserFields name={userName} about={about} onName={setUserName} onAbout={setAbout} />
        </div>}

        {step === 1 && <div key={1} className={'setup-body ' + direction}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">YOUR ORGANIZATION</div>
            <h1 className="h1">Name your organization</h1>
          </div>
          <label className="field"><span className="field-label">Organization name</span>
            <input className="input" autoFocus value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Acme Robotics" />
          </label>
          <label className="field"><span className="field-label">Task prefix</span>
            <input className="input mono" value={shownKey} onChange={e => { setKeyEdited(true); setKey(cleanKey(e.target.value)); }} style={{ width: 120 }} />
          </label>
        </div>}

        {step === 2 && <div key={2} className={'setup-body ' + direction}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">YOUR CHIEF EXECUTIVE</div>
            <h1 className="h1">Name your CEO agent</h1>
          </div>
          <label className="field"><span className="field-label">CEO name</span>
            <input className="input" autoFocus value={ceoName} maxLength={40} onChange={e => setCeoName(e.target.value)} />
          </label>
        </div>}

        {step === 3 && <div key={3} className={'setup-body ' + direction}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">CONNECT</div>
            <h1 className="h1">Connect {ceoName.trim() || 'the CEO'} to a model</h1>
          </div>
          <ProviderConnect onChange={setProvider} />
        </div>}

        {step === 4 && <div key={4} className={'setup-body ' + direction}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">YOUR TEAM</div>
            <h1 className="h1">Build your team with {ceoName.trim() || 'the CEO'}</h1>
          </div>
          <p className="setup-hint">{ceoName.trim() || 'The CEO'} interviews you about what you're working on, then proposes a mission and the seats to hire. Skip goes straight to the workspace; you can onboard later from Help.</p>
          {!provider && <div className="setup-hint" role="status">Onboarding needs a connected model. <button type="button" className="link-btn" onClick={() => setStep(3)}>Connect a model first →</button></div>}
        </div>}

        <Reveal show={Boolean(error)}><div role="alert" className="setup-hint" style={{ color: 'var(--text)' }}>{error}</div></Reveal>

        <div className="setup-actions">
          {step > 0 && <button type="button" className="btn btn-ghost pop-in" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>}
          {step === 3 && <button type="button" className="btn btn-ghost pop-in" disabled={busy} onClick={() => { setProvider(null); setStep(4); }} style={{ marginLeft: 'auto' }}>Skip for now</button>}
          {step === 4 && <button type="button" className="btn btn-ghost pop-in" disabled={busy} onClick={() => void finish(false)} style={{ marginLeft: 'auto' }}>Skip</button>}
          <button type="submit" className="btn btn-primary lg" disabled={!ok || busy} style={step >= 3 ? undefined : { marginLeft: 'auto' }}>
            {step < 4 ? 'Continue' : busy ? 'Saving…' : 'Start onboarding'}
          </button>
        </div>
      </form>
    </div>
  );
}
