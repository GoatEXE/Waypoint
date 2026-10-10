import { useEffect, useRef, useState } from 'react';
import { api, type HermesLogin, type HermesStatus } from '../api';
import { isActiveLogin, isMissingLoginError, shouldClearLoginPrompt } from '../connectorsModel';
import { providerReadiness } from '../providerConfig';
import type { Provider } from '../settingsModel';
import { Reveal } from './Reveal';
import { ProviderMark } from './ProviderMark';

export type ProviderChoice = 'codex' | 'claude';

const CHOICES: { id: ProviderChoice; name: string; subscription: Provider; apiKey: Provider; flow: 'device' | 'authorization-code' }[] = [
  { id: 'codex', name: 'Codex', subscription: 'openai-codex', apiKey: 'openai-api', flow: 'device' },
  { id: 'claude', name: 'Claude', subscription: 'anthropic', apiKey: 'anthropic', flow: 'authorization-code' },
];

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
    <div className="stack">
      <div className="provider-cards">
        {CHOICES.map(c => {
          const connected = providerReadiness(status, c.subscription).on || providerReadiness(status, c.apiKey).on;
          return (
            <button key={c.id} type="button" className={'provider-card' + (choice === c.id ? ' on' : '')} aria-pressed={choice === c.id} onClick={() => pick(c.id)}>
              <ProviderMark kind={c.id} />
              <span className="provider-card-name">{c.name}</span>
              <span className="provider-card-sub">{connected ? 'Connected' : choice === c.id && apiKeyMode ? 'API key' : 'Subscription'}</span>
            </button>
          );
        })}
      </div>

      <Reveal show={Boolean(option && !ready)}>
        <div className="stack">
          <Reveal show={!apiKeyMode && !login}>
            <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={!running || !!busy} onClick={() => void signIn()}>{!running ? 'Starting…' : busy === 'login' ? 'Opening…' : `Sign in to ${option?.name}`}</button>
          </Reveal>
          <Reveal show={!apiKeyMode && Boolean(login?.authUrl)}>
            <a className="btn btn-ghost" style={{ display: 'block', textAlign: 'center' }} href={login?.authUrl || '#'} target="_blank" rel="noreferrer">Open {option?.name} sign-in</a>
          </Reveal>
          <Reveal show={!apiKeyMode && Boolean(login?.userCode)}>
            <div className="provider-code mono">{login?.userCode}</div>
          </Reveal>
          <Reveal show={!apiKeyMode && Boolean(login?.requiresCode && login.state === 'pending')}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitCode(); } }} placeholder="Authorization code" style={{ flex: 1, minWidth: 0 }} />
              <button type="button" className="btn btn-primary" disabled={!code.trim() || !!busy} onClick={() => void submitCode()}>Submit</button>
            </div>
          </Reveal>
          <Reveal show={!apiKeyMode && (login?.state === 'failed' || login?.state === 'cancelled')}>
            <button type="button" className="btn btn-ghost" style={{ width: '100%' }} onClick={() => void signIn()}>Try again</button>
          </Reveal>
          <Reveal show={!apiKeyMode && Boolean(login?.message && login.state !== 'pending')}>
            <div role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>{login?.message}</div>
          </Reveal>
          <Reveal show={apiKeyMode}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveKey(); } }} placeholder={`${option?.name === 'Codex' ? 'OpenAI' : 'Anthropic'} API key`} style={{ flex: 1, minWidth: 0 }} disabled={!running} />
              <button type="button" className="btn btn-primary" disabled={!running || !key.trim() || !!busy} onClick={() => void saveKey()}>Save</button>
            </div>
          </Reveal>
          <Reveal show>
            <button type="button" className="link-btn" onClick={() => { setApiKeyMode(v => !v); setLogin(null); setCode(''); setKey(''); setError(''); }}>{apiKeyMode ? 'Use my subscription' : 'I have an API key'}</button>
          </Reveal>
        </div>
      </Reveal>
      <Reveal show={Boolean(error)}>
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--text)' }}>{error}</div>
      </Reveal>
    </div>
  );
}
