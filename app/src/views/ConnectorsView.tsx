import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type HermesLogin, type HermesStatus } from '../api';
import { OnDot, WorkspaceHead } from '../components/ui';
import { isActiveLogin, isMissingLoginError, shouldApplyMissingLoginRecovery, shouldClearLoginPrompt, shouldShowLoginPromptMaterial, statusHasUncheckedNativeAuth, toConnectorProvider } from '../connectorsModel';
import { providerReadiness } from '../providerConfig';
import type { Provider } from '../settingsModel';
import { GitHubSetup, githubReadiness, githubRepos, useGitHubStatus } from './GitHubConnector';

type ProviderGroupId = 'openai' | 'anthropic';
type Method = 'subscription' | 'api_key';
type MethodConfig = { id: Method; label: string; provider: Provider; flow?: 'device' | 'authorization-code'; note: string };
type ProviderGroup = { id: ProviderGroupId; name: string; note: string; methods: MethodConfig[] };

const PROVIDER_GROUPS: ProviderGroup[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    note: 'Codex sign-in or OpenAI API key.',
    methods: [
      { id: 'subscription', label: 'Codex sign-in', provider: 'openai-codex', flow: 'device', note: 'Sign in with your OpenAI account.' },
      { id: 'api_key', label: 'API key', provider: 'openai-api', note: 'Use an OpenAI API key.' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    note: 'Claude sign-in or Anthropic API key.',
    methods: [
      { id: 'subscription', label: 'Claude sign-in', provider: 'anthropic', flow: 'authorization-code', note: 'Sign in with Claude, then paste the returned code.' },
      { id: 'api_key', label: 'API key', provider: 'anthropic', note: 'Use an Anthropic API key.' },
    ],
  },
];

export function ConnectorsView() {
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<ProviderGroupId>('openai');
  const [showGithub, setShowGithub] = useState(() => new URLSearchParams(window.location.search).get('connector') === 'github');
  const [category, setCategory] = useState<'all' | 'ai' | 'code'>('all');
  const github = useGitHubStatus();
  const githubState = githubReadiness(github.status);
  const [methodByGroup, setMethodByGroup] = useState<Record<ProviderGroupId, Method>>({ openai: 'subscription', anthropic: 'subscription' });
  const [login, setLogin] = useState<HermesLogin | null>(null);
  const [code, setCode] = useState('');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const statusRequest = useRef(0);
  const freshAuthProbeStarted = useRef(false);

  const activeGroup = PROVIDER_GROUPS.find(group => group.id === activeGroupId) || PROVIDER_GROUPS[0];
  const activeMethodId = methodByGroup[activeGroup.id];
  const activeMethod = activeGroup.methods.find(method => method.id === activeMethodId) || activeGroup.methods[0];
  const runtimeRunning = Boolean(status?.runtime.running);
  const activeMethodReady = providerReadiness(status, activeMethod.provider).on;

  const loadStatus = async (options: { freshAuth?: boolean } = {}) => {
    const request = ++statusRequest.current;
    try {
      const next = await api.hermesStatus(options);
      if (request !== statusRequest.current) return;
      setStatus(next);
      setError('');
    } catch (e) {
      if (request === statusRequest.current) setError(e instanceof Error ? e.message : 'Could not reach service');
    }
  };

  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    if (freshAuthProbeStarted.current || !statusHasUncheckedNativeAuth(status)) return;
    freshAuthProbeStarted.current = true;
    loadStatus({ freshAuth: true });
  }, [status]);
  useEffect(() => {
    if (!isActiveLogin(login)) return;
    const currentLogin = login!;
    const t = window.setInterval(async () => {
      try {
        applyLoginUpdate(await api.getLogin(currentLogin.provider, currentLogin.id));
      } catch (e) {
        if (isMissingLoginError(e)) expireMissingLogin(currentLogin);
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [login]);

  const rows = useMemo(() => PROVIDER_GROUPS.map(group => ({ group, readiness: groupReadiness(status, group) })), [status]);
  const attentionCount = rows.filter(row => status && !row.readiness.on).length;

  const act = async (label: string, fn: () => Promise<unknown>, options: { freshAuth?: boolean } = {}) => {
    setBusy(label); setError('');
    try { await fn(); await loadStatus(options); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(''); }
  };
  const expireMissingLogin = (current: HermesLogin) => {
    setLogin(active => {
      if (!shouldApplyMissingLoginRecovery(active, current)) return active;
      setCode('');
      return { ...current, state: 'failed', authUrl: '', userCode: '', updatedAt: new Date().toISOString(), message: 'Sign-in session expired. Start a fresh login.' };
    });
  };
  const checkLoginStatus = async (current: HermesLogin) => {
    try {
      applyLoginUpdate(await api.getLogin(current.provider, current.id));
    } catch (e) {
      if (!isMissingLoginError(e)) throw e;
      expireMissingLogin(current);
    }
  };
  const applyLoginUpdate = (next: HermesLogin) => {
    if (shouldClearLoginPrompt(next)) {
      setCode('');
      setLogin(null);
      loadStatus({ freshAuth: true });
      return;
    }
    if (next.state === 'failed' || next.state === 'cancelled') setCode('');
    setLogin(next);
    if (next.state === 'failed' || next.state === 'cancelled') loadStatus({ freshAuth: true });
  };
  const startLoginForProvider = async (provider: string) => {
    const flow = provider === 'openai-codex' ? 'device' : provider === 'anthropic' ? 'authorization-code' : '';
    const typedProvider = toConnectorProvider(provider);
    if (!flow || !typedProvider) return;
    setBusy('login'); setError('');
    try {
      const next = await api.startLogin(provider, flow);
      setCode('');
      setLogin(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(''); }
  };
  const startProviderLogin = () => {
    if (activeMethod.id !== 'subscription' || !activeMethod.flow) return;
    startLoginForProvider(activeMethod.provider);
  };
  const submitCode = () => {
    if (!login || !code.trim()) return;
    act('code', async () => {
      applyLoginUpdate(await api.submitLoginCode(login.provider, login.id, code.trim()));
    }, { freshAuth: true });
  };
  const saveKey = () => {
    const value = keys[activeMethod.provider]?.trim();
    if (!value || activeMethod.id !== 'api_key') return;
    act('api-key', async () => {
      await api.saveApiKey(activeMethod.provider, value);
      setKeys(k => ({ ...k, [activeMethod.provider]: '' }));
    }, { freshAuth: true });
  };

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 20 }}>
      <WorkspaceHead title="Connectors" lede="Provider accounts and GitHub access for Waypoint." />
      {error && <div className="card" role="alert" style={{ padding: 12, borderColor: 'var(--border-6)', color: 'var(--text)' }}>{error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button className={'filter' + (category === 'all' ? ' on' : '')} onClick={() => setCategory('all')}>All ({PROVIDER_GROUPS.length + 1})</button>
        <button className={'filter' + (category === 'ai' ? ' on' : '')} onClick={() => { setCategory('ai'); setShowGithub(false); }}>AI providers ({PROVIDER_GROUPS.length})</button>
        <button className={'filter' + (category === 'code' ? ' on' : '')} onClick={() => { setCategory('code'); setShowGithub(true); }}>Code hosting (1)</button>
        <button className="filter" disabled style={{ cursor: 'default', opacity: attentionCount ? 1 : .55 }}>Needs attention ({attentionCount})</button>
        <button className="btn btn-ghost sm" style={{ marginLeft: 'auto' }} disabled={busy === 'refresh'} onClick={() => act('refresh', async () => undefined, { freshAuth: true })}>Refresh</button>
      </div>

      <div className="connector-layout">
        <section className="card" aria-label="Provider connection list" style={{ overflow: 'hidden' }}>
          <div className="connector-table-head">
            <span>Connection</span><span>Methods</span><span>Status</span><span />
          </div>
          {category !== 'code' && rows.map(row => {
            const selected = !showGithub && row.group.id === activeGroupId;
            return (
              <button key={row.group.id} className={'connector-row' + (selected ? ' active' : '')} onClick={() => { setActiveGroupId(row.group.id); setShowGithub(false); }}>
                <span className="connector-name"><ProviderMark label={row.group.name} /><span><strong>{row.group.name}</strong><small>{row.group.note}</small></span></span>
                <span className="connector-muted">{row.group.methods.length} methods</span>
                <span className="connector-status"><OnDot on={row.readiness.on} />{row.readiness.label}</span>
                <span className="connector-action">Manage</span>
              </button>
            );
          })}
          {category !== 'ai' && (
            <button className={'connector-row' + (showGithub ? ' active' : '')} onClick={() => setShowGithub(true)}>
              <span className="connector-name"><ProviderMark label="Git Hub" /><span><strong>GitHub</strong><small>Repository access for designated seats.</small></span></span>
              <span className="connector-muted">GitHub App{githubRepos(github.status).length ? ` · ${githubRepos(github.status).length} repos` : ''}</span>
              <span className="connector-status"><OnDot on={githubState.on} />{githubState.label}</span>
              <span className="connector-action">Manage</span>
            </button>
          )}
        </section>

        {showGithub ? (
          <aside className="card stack" style={{ padding: 16, gap: 16 }} aria-label="GitHub setup">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <ProviderMark label="Git Hub" />
              <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Connect GitHub</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Short-lived, per-repository access through a Waypoint GitHub App.</div>
              </div>
              <StatusBadge on={githubState.on}>{githubState.label}</StatusBadge>
            </div>
            <GitHubSetup status={github.status} setStatus={github.setStatus} reload={() => void github.reload(true)} loadError={github.error} />
          </aside>
        ) : (
        <aside className="card stack" style={{ padding: 16, gap: 16 }} aria-label={`${activeGroup.name} setup`}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <ProviderMark label={activeGroup.name} />
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Connect {activeGroup.name}</h2>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{activeGroup.note}</div>
            </div>
            <StatusBadge on={groupReadiness(status, activeGroup).on}>{groupReadiness(status, activeGroup).label}</StatusBadge>
          </div>

          <div className="segmented" aria-label="Connection method">
            {activeGroup.methods.map(method => <button key={method.id} className={activeMethod.id === method.id ? 'on' : ''} onClick={() => setMethodByGroup(current => ({ ...current, [activeGroup.id]: method.id }))}>{method.label}</button>)}
          </div>

          {!runtimeRunning && <div className="empty" style={{ padding: 12 }}>Start the CEO runtime in Settings before sign-in.</div>}

          <div className="provider-method-card stack" style={{ gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="section-title">{activeMethod.label}</div>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--faint)' }}>{methodStatus(status, activeMethod.provider)}</span>
            </div>
            <p style={smallCopyStyle}>{activeMethod.note}</p>
            {activeMethod.id === 'subscription' ? (
              activeMethodReady ? <div className="stack" style={{ gap: 8 }}><div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Connected.</div><button className="btn btn-ghost" disabled={!!busy || !runtimeRunning} onClick={startProviderLogin}>Reconnect</button></div> : <button className="btn btn-primary" disabled={!!busy || !runtimeRunning} onClick={startProviderLogin}>Sign in</button>
            ) : (
              <>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={keys[activeMethod.provider] || ''}
                  onChange={e => setKeys(k => ({ ...k, [activeMethod.provider]: e.target.value }))}
                  style={inputStyle}
                  placeholder="Enter API key here"
                  disabled={!!busy || !runtimeRunning}
                />
                <button className="btn btn-ghost" disabled={!!busy || !runtimeRunning || !keys[activeMethod.provider]?.trim()} onClick={saveKey}>Save API key</button>
              </>
            )}
          </div>
        </aside>
        )}
      </div>

      {login && <section className="provider-login-panel" aria-label="Pending sign-in">
        <div className="kind">SIGN IN · {providerLabel(login.provider)}</div>
        <div style={{ fontSize: 13 }}>{login.state === 'failed' ? (login.message || 'Sign-in failed. Try again.') : login.state === 'cancelled' ? (login.message || 'Sign-in cancelled.') : login.message}</div>
        {shouldShowLoginPromptMaterial(login) && login.authUrl && <a href={login.authUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--acc-text)', fontSize: 13, wordBreak: 'break-all' }}>{login.authUrl}</a>}
        {shouldShowLoginPromptMaterial(login) && login.userCode && <div style={{ font: '600 22px var(--mono)', letterSpacing: '.08em' }}>{login.userCode}</div>}
        {login.requiresCode && login.state === 'pending' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitCode(); }} style={{ ...inputStyle, flex: '1 1 220px' }} placeholder="Paste authorization code" /><button className="btn btn-primary" disabled={busy === 'code' || !code.trim()} onClick={submitCode}>Submit code</button></div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isActiveLogin(login) && <button className="btn btn-ghost" disabled={busy === 'check'} onClick={() => act('check', async () => checkLoginStatus(login), { freshAuth: true })}>Check status</button>}
          {login.state === 'pending' && <button className="btn btn-ghost" disabled={busy === 'cancel'} onClick={() => act('cancel', async () => applyLoginUpdate(await api.cancelLogin(login.provider, login.id)), { freshAuth: true })}>Cancel</button>}
          {(login.state === 'failed' || login.state === 'cancelled') && <button className="btn btn-primary" disabled={!!busy || !runtimeRunning} onClick={() => startLoginForProvider(login.provider)}>Try again</button>}
        </div>
      </section>}
    </div>
  );
}

function groupReadiness(status: HermesStatus | null, group: ProviderGroup) {
  if (!status) return { label: 'Unknown', on: false };
  if (!status.runtime.running) return { label: status.runtime.state === 'missing' ? 'Container missing' : 'Stopped', on: false };
  const statuses = group.methods.map(method => providerReadiness(status, method.provider));
  if (statuses.some(item => item.on)) return { label: 'Connected', on: true };
  if (statuses.some(item => item.label === 'Credential saved')) return { label: 'Credential saved', on: false };
  return { label: 'Not connected', on: false };
}
function methodStatus(status: HermesStatus | null, provider: Provider) {
  return providerReadiness(status, provider).label;
}
function ProviderMark({ label }: { label: string }) {
  return <span className="provider-mark">{label.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span>;
}
function StatusBadge({ on, children }: { on: boolean; children: string }) {
  return <span className="status-badge" style={{ color: on ? 'var(--text-3)' : 'var(--faint)' }}><OnDot on={on} />{children}</span>;
}
function providerLabel(provider: string) {
  if (provider === 'openai-codex' || provider === 'openai-api') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  return provider;
}

const inputStyle = { background: 'var(--well)', border: '1px solid var(--border-3)', borderRadius: 8, color: 'var(--text)', padding: '10px 12px', font: '400 12.5px var(--mono)', minWidth: 0 } as const;
const smallCopyStyle = { margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45 } as const;
