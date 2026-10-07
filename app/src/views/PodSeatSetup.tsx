import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type AppConfig, type HermesModelCatalog, type PodInstance, type PodSeatLogin, type PodSeatStatus, type PodSeatStatusResponse, type SeatModel } from '../api';

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-sonnet-5', apiMode: 'anthropic_messages' },
  { id: 'openai-codex', label: 'OpenAI Codex', defaultModel: 'gpt-5-codex', apiMode: 'responses' },
  { id: 'openai-api', label: 'OpenAI API', defaultModel: 'gpt-5', apiMode: 'responses' },
];

type Notice = { kind: 'status' | 'error' | 'success'; text: string } | null;
const LOGIN_POLL_MS = 2500;
const LOGIN_MAX_POLLS = 120;

const providerLabel = (id: string) => PROVIDERS.find(p => p.id === id)?.label || id;
const cap = (text: string) => text ? text.charAt(0).toUpperCase() + text.slice(1).replaceAll('_', ' ') : 'Unknown';

function blockerText(blocker: string): string {
  if (blocker === 'dry_run') return 'Dry-run mode: checks are planned only.';
  if (blocker === 'model_unconfigured') return 'Choose and save a model.';
  if (blocker === 'model_not_applied') return 'Prepare the seat to apply the saved model.';
  if (blocker === 'auth_not_ready') return 'Connect this seat to its provider.';
  if (blocker.startsWith('profile_')) return `Profile needs attention: ${cap(blocker.slice('profile_'.length))}.`;
  return cap(blocker);
}

function readinessLine(seat?: PodSeatStatus): string {
  if (!seat) return 'Readiness has not been checked yet.';
  if (seat.ready) return 'Ready for task runs.';
  if (!seat.blockers.length) return 'Not ready yet.';
  return seat.blockers.map(blockerText).join(' ');
}

function modelFromSeat(seat?: PodSeatStatus): SeatModel | null {
  return seat?.model?.requested || null;
}

function modelFromCatalog(catalog: HermesModelCatalog | null, provider: string): { defaultModel: string; apiMode: string; models: { id: string; name: string }[] } {
  const fromCatalog = catalog?.providers.find(p => p.id === provider);
  const fallback = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0];
  return {
    defaultModel: fromCatalog?.default || fallback.defaultModel,
    apiMode: fromCatalog?.api_mode || fallback.apiMode,
    models: (fromCatalog?.models || []).map(m => ({ id: m.id, name: m.name || m.id })),
  };
}

function ActionButton({ children, onClick, disabled = false, primary = false }: { children: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button className={`btn ${primary ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '7px 12px', color: primary ? undefined : 'var(--text)' }} onClick={onClick} disabled={disabled}>{children}</button>;
}

function isPreviewOnly(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as { dryRun?: unknown }).dryRun === true && (result as { executed?: unknown }).executed === false);
}

function isActiveLogin(login: PodSeatLogin | null): login is PodSeatLogin {
  return login?.state === 'pending' || login?.state === 'cancelling';
}

export function PodSeatSetup({ pod, selectedSeatId, onPodChanged }: { pod: PodInstance; selectedSeatId: string; onPodChanged: () => Promise<void> | void }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<PodSeatStatusResponse | null>(null);
  const [catalog, setCatalog] = useState<HermesModelCatalog | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [provider, setProvider] = useState('anthropic');
  const [modelId, setModelId] = useState('');
  const [login, setLogin] = useState<PodSeatLogin | null>(null);
  const [code, setCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  const loginPollTimer = useRef<number | null>(null);
  const loginPollCount = useRef(0);

  const selectedStatus = useMemo(() => status?.seats.find(s => s.seatId === selectedSeatId), [selectedSeatId, status]);
  const providerInfo = modelFromCatalog(catalog, provider);
  const appliedModel = selectedStatus?.model?.state === 'configured' ? selectedStatus.model.requested : null;
  const draftMatchesApplied = Boolean(appliedModel && appliedModel.provider === provider && appliedModel.default === (modelId || providerInfo.defaultModel));
  const canConnectProvider = Boolean(selectedSeatId && draftMatchesApplied);
  const canUseApiKey = canConnectProvider && (appliedModel?.provider === 'anthropic' || appliedModel?.provider === 'openai-api');
  const connectionProvider = appliedModel?.provider || '';

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    const cfg = await api.config().catch(() => null);
    setConfig(cfg);
    try {
      const seatStatus = await api.podSeatStatus(pod.id);
      setStatus(seatStatus);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoadingStatus(false);
    }
  }, [pod.id]);

  useEffect(() => {
    void refreshStatus();
    api.hermesModelCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, [refreshStatus]);

  useEffect(() => {
    const saved = modelFromSeat(selectedStatus);
    const nextProvider = saved?.provider || provider;
    const info = modelFromCatalog(catalog, nextProvider);
    setProvider(nextProvider);
    setModelId(saved?.default || info.defaultModel);
    setLogin(null);
    setCode('');
    setApiKey('');

  }, [selectedSeatId, selectedStatus?.model?.requested?.provider, selectedStatus?.model?.requested?.default, catalog]);

  useEffect(() => {
    const info = modelFromCatalog(catalog, provider);
    setModelId(current => current || info.defaultModel);
  }, [catalog, provider]);

  const clearLoginPoll = useCallback(() => {
    if (loginPollTimer.current) window.clearTimeout(loginPollTimer.current);
    loginPollTimer.current = null;
  }, []);

  const applyLoginUpdate = useCallback((next: PodSeatLogin) => {
    setLogin(next);
    if (next.state === 'authorized') {
      setCode('');
      void refreshStatus();
    }
    if (next.state === 'failed' || next.state === 'cancelled') setCode('');
  }, [refreshStatus]);

  const pollLogin = useCallback((current: PodSeatLogin) => {
    clearLoginPoll();
    if (!isActiveLogin(current) || loginPollCount.current >= LOGIN_MAX_POLLS) return;
    loginPollCount.current += 1;
    loginPollTimer.current = window.setTimeout(async () => {
      try {
        const next = await api.getSeatLogin(pod.id, current.seatId, current.provider, current.id);
        applyLoginUpdate(next);
      } catch {
        clearLoginPoll();
      }
    }, LOGIN_POLL_MS);
  }, [applyLoginUpdate, clearLoginPoll, pod.id]);

  useEffect(() => {
    if (!isActiveLogin(login)) { clearLoginPoll(); return; }
    pollLogin(login);
    return clearLoginPoll;
  }, [clearLoginPoll, login, pollLogin]);

  useEffect(() => () => clearLoginPoll(), [clearLoginPoll]);

  const doAction = async (label: string, action: () => Promise<unknown>, after?: () => Promise<void> | void) => {
    setBusy(label);
    setNotice({ kind: 'status', text: `${label}…` });
    try {
      const result = await action();
      if (isPreviewOnly(result)) setNotice({ kind: 'status', text: 'Preview only, no pod/seat changed.' });
      else setNotice({ kind: 'success', text: `${label} done.` });
      await after?.();
      await refreshStatus();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy('');
    }
  };

  const saveModel = () => {
    const info = modelFromCatalog(catalog, provider);
    const model: SeatModel = { provider, default: modelId || info.defaultModel, ...(info.apiMode ? { api_mode: info.apiMode } : {}) };
    return doAction('Save model', () => api.saveSeatModel(pod.id, selectedSeatId, model), onPodChanged);
  };

  const startLogin = async (targetProvider: string) => {
    setBusy(`Connect ${providerLabel(targetProvider)}`);
    setNotice({ kind: 'status', text: `Starting ${providerLabel(targetProvider)} connection for this seat…` });
    setCode('');
    try {
      const flow = targetProvider === 'openai-codex' ? 'device' : 'authorization-code';
      const next = await api.startSeatLogin(pod.id, selectedSeatId, targetProvider, flow);
      loginPollCount.current = 0;
      applyLoginUpdate(next);
      setNotice({ kind: 'status', text: next.message || 'Connection started.' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy('');
    }
  };

  const checkLogin = () => login && doAction('Check connection', async () => { applyLoginUpdate(await api.getSeatLogin(pod.id, selectedSeatId, login.provider, login.id)); });
  const cancelLogin = () => login && doAction('Cancel connection', async () => { applyLoginUpdate(await api.cancelSeatLogin(pod.id, selectedSeatId, login.provider, login.id)); setCode(''); });
  const submitCode = () => login && doAction('Submit code', async () => { applyLoginUpdate(await api.submitSeatLoginCode(pod.id, selectedSeatId, login.provider, login.id, code)); setCode(''); }, refreshStatus);
  const saveKey = () => {
    if (!appliedModel) return;
    return doAction('Save API key', async () => { await api.saveSeatApiKey(pod.id, selectedSeatId, appliedModel.provider, apiKey); setApiKey(''); }, refreshStatus);
  };

  const authProviders = selectedStatus?.auth?.providers || {};
  const providerConnection = connectionProvider ? authProviders[connectionProvider] : undefined;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 8, padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="section-title">Setup for <span className="mono">{selectedSeatId || 'seat'}</span></div>
          {config?.dryRun && <span className="sb-label" style={{ color: 'var(--text-3)' }}>DRY RUN</span>}
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '7px 12px', color: 'var(--text)' }} onClick={() => void refreshStatus()} disabled={loadingStatus}>{loadingStatus ? 'Checking…' : 'Refresh readiness'}</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.45 }}>
          {config?.sharedAuth?.enabled
            ? 'Each seat needs a model. Pods share the CEO provider connections; connect a missing provider in Settings.'
            : 'Each seat needs a model and its own provider connection.'}
        </div>
        <div style={{ fontSize: 13, color: selectedStatus?.ready ? 'var(--text)' : 'var(--text-3)', lineHeight: 1.45 }}>{readinessLine(selectedStatus)}</div>
        {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} style={{ fontSize: 12.5, color: notice.kind === 'error' ? 'var(--text)' : 'var(--text-3)' }}>{notice.text}</div>}
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="section-title">Pod controls</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ActionButton primary onClick={() => void doAction('Start pod', () => api.podLifecycle(pod.id, 'start'), onPodChanged)} disabled={Boolean(busy)}>Start pod</ActionButton>
          <ActionButton onClick={() => void doAction('Stop pod', () => api.podLifecycle(pod.id, 'stop'), onPodChanged)} disabled={Boolean(busy)}>Stop pod</ActionButton>
          <ActionButton onClick={() => void doAction('Check pod', () => api.podLifecycle(pod.id, 'status'), onPodChanged)} disabled={Boolean(busy)}>Check pod</ActionButton>
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="section-title">Model</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 220px) minmax(180px, 1fr)', gap: 8 }}>
          <label className="stack" style={{ gap: 5, fontSize: 12, color: 'var(--faint)' }}>Provider
            <select value={provider} onChange={event => { setProvider(event.target.value); setModelId(modelFromCatalog(catalog, event.target.value).defaultModel); }} style={{ minWidth: 0 }}>
              {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 5, fontSize: 12, color: 'var(--faint)' }}>Model
            <select value={modelId || providerInfo.defaultModel} onChange={event => setModelId(event.target.value)} style={{ minWidth: 0 }}>
              {(providerInfo.models.length ? providerInfo.models : [{ id: providerInfo.defaultModel, name: providerInfo.defaultModel }]).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
        </div>
        <div className="meta-row" style={{ gap: '6px 16px' }}>
          <span>Saved model <span className="v">{selectedStatus?.model?.requested ? `${providerLabel(selectedStatus.model.requested.provider)} · ${selectedStatus.model.requested.default}` : 'None'}</span></span>
          <span>Profile model <span className="v">{selectedStatus?.model?.state ? cap(selectedStatus.model.state) : 'Not checked'}</span></span>
        </div>
        {!canConnectProvider && <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>Save the selected model and prepare the seat before connecting a provider.</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ActionButton primary onClick={() => void saveModel()} disabled={!selectedSeatId || Boolean(busy)}>Save model</ActionButton>
          <ActionButton onClick={() => void doAction('Prepare seat', () => api.provisionPodSeats(pod.id, [selectedSeatId]), refreshStatus)} disabled={!selectedSeatId || Boolean(busy)}>Prepare seat</ActionButton>
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="section-title">Provider connection</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-4)' }}>
          {connectionProvider ? (providerConnection ? `${providerLabel(connectionProvider)}: ${providerConnection.authenticated ? 'connected' : cap(providerConnection.state || 'not connected')}. ${providerConnection.message || ''}` : `${providerLabel(connectionProvider)} has not been checked for this seat.`) : 'No applied model provider yet.'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!config?.sharedAuth?.enabled && provider === 'anthropic' && <ActionButton onClick={() => void startLogin('anthropic')} disabled={Boolean(busy) || !canConnectProvider || providerConnection?.authenticated}>Connect Claude OAuth</ActionButton>}
          {!config?.sharedAuth?.enabled && provider === 'openai-codex' && <ActionButton onClick={() => void startLogin('openai-codex')} disabled={Boolean(busy) || !canConnectProvider || providerConnection?.authenticated}>Connect Codex device</ActionButton>}
          {provider === 'openai-api' && <span style={{ fontSize: 12.5, color: 'var(--faint)', alignSelf: 'center' }}>Use an OpenAI API key for this seat.</span>}
        </div>

        {login && (
          <div className="stack" style={{ gap: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{providerLabel(login.provider)} connection: {cap(login.state)}</div>
            {login.message && <div style={{ fontSize: 12.5, color: 'var(--text-4)' }}>{login.message}</div>}
            {login.state === 'pending' && login.authUrl && <a className="ul" href={login.authUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>Open provider sign-in</a>}
            {login.state === 'pending' && login.userCode && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Device code: <span className="mono">{login.userCode}</span></div>}
            {login.state === 'pending' && login.requiresCode && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input type="password" value={code} onChange={event => setCode(event.target.value)} placeholder="Paste authorization code" autoComplete="off" style={{ minWidth: 220 }} />
                <ActionButton primary onClick={() => void submitCode()} disabled={code.trim().length < 4 || Boolean(busy)}>Submit code</ActionButton>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ActionButton onClick={() => void checkLogin()} disabled={Boolean(busy)}>Check connection</ActionButton>
              {(login.state === 'pending' || login.state === 'cancelling') && <ActionButton onClick={() => void cancelLogin()} disabled={Boolean(busy)}>Cancel</ActionButton>}
            </div>
          </div>
        )}

        {(provider === 'anthropic' || provider === 'openai-api') && (
          <div className="stack" style={{ gap: 8 }}>
            <label className="stack" style={{ gap: 5, fontSize: 12, color: 'var(--faint)' }}>API key fallback for {providerLabel(provider)}
              <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Stored only for this seat" autoComplete="off" />
            </label>
            <ActionButton onClick={() => void saveKey()} disabled={!canUseApiKey || apiKey.length < 8 || Boolean(busy)}>Save API key</ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
