import { useEffect, useRef, useState } from 'react';
import { api, type HermesLogin, type HermesStatus } from '../api';
import { isActiveLogin, isMissingLoginError, shouldClearLoginPrompt } from '../connectorsModel';
import { providerReadiness } from '../providerConfig';
import type { Provider } from '../settingsModel';

export type ProviderChoice = 'codex' | 'claude';

const CHOICES: { id: ProviderChoice; name: string; subscription: Provider; apiKey: Provider; flow: 'device' | 'authorization-code' }[] = [
  { id: 'codex', name: 'Codex', subscription: 'openai-codex', apiKey: 'openai-api', flow: 'device' },
  { id: 'claude', name: 'Claude', subscription: 'anthropic', apiKey: 'anthropic', flow: 'authorization-code' },
];

function Mark({ id }: { id: ProviderChoice }) {
  if (id === 'claude') {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1="12" y1="12" x2="12" y2={i % 2 ? 4.5 : 2} stroke="#D97757" strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 30} 12 12)`} />)}
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,2.5 20.2,7.25 20.2,16.75 12,21.5 3.8,16.75 3.8,7.25" fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.5 10l2.5 2-2.5 2M13 14.5h3" fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function connectedProvider(status: HermesStatus | null, choice: ProviderChoice | null, apiKeyMode: boolean): Provider | null {
  const option = CHOICES.find(c => c.id === choice);
  if (!option) return null;
  const provider = apiKeyMode ? option.apiKey : option.subscription;
  return providerReadiness(status, provider).on ? provider : null;
}

export function ProviderConnect({ onChange }: { onChange: (provider: Provider | null) => void }) {
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [choice, setChoice] = useState<ProviderChoice | null>(null);
  const [apiKeyMode, setApiKeyMode] = useState(false);
  const [login, setLogin] = useState<HermesLogin | null>(null);
  const [code, setCode] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const statusRequest = useRef(0);

  const loadStatus = async (fresh = false) => {
    const request = ++statusRequest.current;
    try {
      const next = await api.hermesStatus({ freshAuth: fresh });
      if (request === statusRequest.current) setStatus(next);
    } catch (e) { if (request === statusRequest.current) setError(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => { void loadStatus(true); }, []);
  useEffect(() => {
    if (status?.runtime.running) return;
    const timer = window.setInterval(() => void loadStatus(true), 3000);
    return () => window.clearInterval(timer);
  }, [status?.runtime.running]);
  useEffect(() => { onChange(connectedProvider(status, choice, apiKeyMode)); }, [status, choice, apiKeyMode]);
  useEffect(() => {
    if (!isActiveLogin(login)) return;
    const current = login!;
    const timer = window.setInterval(async () => {
      try { applyLogin(await api.getLogin(current.provider, current.id)); }
      catch (e) { if (isMissingLoginError(e)) setLogin({ ...current, state: 'failed', authUrl: '', userCode: '', message: 'Sign-in expired. Try again.' }); }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [login]);

  const option = CHOICES.find(c => c.id === choice);
  const provider = option ? (apiKeyMode ? option.apiKey : option.subscription) : null;
  const ready = provider ? providerReadiness(status, provider).on : false;
  const running = Boolean(status?.runtime.running);

  const applyLogin = (next: HermesLogin) => {
    if (shouldClearLoginPrompt(next)) { setLogin(null); setCode(''); void loadStatus(true); return; }
    setLogin(next);
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  const pick = (id: ProviderChoice) => {
    if (id === choice) return;
    setChoice(id); setApiKeyMode(false); setLogin(null); setCode(''); setKey(''); setError('');
  };
  const signIn = () => option && run('login', async () => { setCode(''); setLogin(await api.startLogin(option.subscription, option.flow)); });
  const submitCode = () => login && code.trim() && run('code', async () => { applyLogin(await api.submitLoginCode(login.provider, login.id, code.trim())); await loadStatus(true); });
  const saveKey = () => provider && key.trim() && run('key', async () => { await api.saveApiKey(provider, key.trim()); setKey(''); await loadStatus(true); });

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="provider-cards">
        {CHOICES.map(c => {
          const connected = providerReadiness(status, c.subscription).on || providerReadiness(status, c.apiKey).on;
          return (
            <button key={c.id} type="button" className={'provider-card' + (choice === c.id ? ' on' : '')} aria-pressed={choice === c.id} onClick={() => pick(c.id)}>
              <Mark id={c.id} />
              <span className="provider-card-name">{c.name}</span>
              <span className="provider-card-sub">{connected ? 'Connected' : choice === c.id && apiKeyMode ? 'API key' : 'Subscription'}</span>
            </button>
          );
        })}
      </div>

      {option && !ready && (
        <div className="stack" style={{ gap: 10 }}>
          {!apiKeyMode && !login && <button type="button" className="btn btn-primary" disabled={!running || !!busy} onClick={() => void signIn()}>{!running ? 'Starting…' : busy === 'login' ? 'Opening…' : `Sign in to ${option.name}`}</button>}
          {!apiKeyMode && login && (
            <div className="stack" style={{ gap: 8 }}>
              {login.authUrl && <a className="btn btn-ghost" href={login.authUrl} target="_blank" rel="noreferrer">Open {option.name} sign-in</a>}
              {login.userCode && <div className="provider-code mono">{login.userCode}</div>}
              {login.requiresCode && login.state === 'pending' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitCode(); } }} placeholder="Authorization code" style={{ flex: 1, minWidth: 0 }} />
                  <button type="button" className="btn btn-primary" disabled={!code.trim() || !!busy} onClick={() => void submitCode()}>Submit</button>
                </div>
              )}
              {(login.state === 'failed' || login.state === 'cancelled') && <button type="button" className="btn btn-ghost" onClick={() => void signIn()}>Try again</button>}
              {login.message && login.state !== 'pending' && <span role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>{login.message}</span>}
            </div>
          )}
          {apiKeyMode && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveKey(); } }} placeholder={`${option.name === 'Codex' ? 'OpenAI' : 'Anthropic'} API key`} style={{ flex: 1, minWidth: 0 }} disabled={!running} />
              <button type="button" className="btn btn-primary" disabled={!running || !key.trim() || !!busy} onClick={() => void saveKey()}>Save</button>
            </div>
          )}
          <button type="button" className="link-btn" onClick={() => { setApiKeyMode(v => !v); setLogin(null); setCode(''); setKey(''); setError(''); }}>{apiKeyMode ? 'Use my subscription' : 'I have an API key'}</button>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>}
    </div>
  );
}
