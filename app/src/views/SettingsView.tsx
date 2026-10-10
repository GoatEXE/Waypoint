import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type HermesModelCatalog, type HermesModelOption, type HermesModelProviderCatalog, type HermesStatus } from '../api';
import { OnDot, WorkspaceHead } from '../components/ui';
import { OrganizationSettings } from './OrganizationSettings';
import { PROVIDERS, RECOMMENDED_MODELS, authForProvider } from '../providerConfig';
import { applySavedModelIfClean, DEFAULTS, defaultModelForProvider as defaultCatalogModelForProvider, type ModelState, type Provider } from '../settingsModel';
import { errorText, runtimeHealth } from '../runtimeHealth';
import { StartCeoButton } from '../components/RuntimeBanner';
import { useStore } from '../store';

const CUSTOM = '__custom__';

function providerCatalog(catalog: HermesModelCatalog | null, provider: Provider): HermesModelProviderCatalog | undefined {
  return catalog?.providers.find(p => p.id === provider);
}
function isCodexLongContextVariant(id: string) {
  return id.toLowerCase().endsWith('-900k');
}
function optionLabel(option: HermesModelOption, _provider: Provider) {
  return option.name || option.id;
}
function catalogRecommendedModels(models: HermesModelOption[], provider: Provider) {
  const byId = new Map(models.map(m => [m.id, m]));
  const recommended = RECOMMENDED_MODELS[provider].map(id => byId.get(id)).filter((m): m is HermesModelOption => Boolean(m));
  if (recommended.length) return recommended;
  return models.filter(m => provider !== 'openai-codex' || !isCodexLongContextVariant(m.id)).slice(0, 4);
}
function defaultModelForProvider(provider: Provider, catalogProvider?: HermesModelProviderCatalog) {
  return defaultCatalogModelForProvider(provider, catalogProvider, RECOMMENDED_MODELS[provider]);
}

export function SettingsView() {
  const nav = useNavigate();
  const { state: appState } = useStore();
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [catalog, setCatalog] = useState<HermesModelCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [model, setModel] = useState<ModelState>({ provider: 'openai-codex', default: DEFAULTS['openai-codex'].default, base_url: '', api_mode: DEFAULTS['openai-codex'].api_mode });
  const [advanced, setAdvanced] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
  const catalogRequest = useRef(0);
  const statusRequest = useRef(0);
  const modelRevision = useRef(0);
  const modelDirty = useRef(false);

  const markModelDirty = () => { modelDirty.current = true; modelRevision.current += 1; };
  const loadCatalog = async (options: { refresh?: boolean } = {}) => {
    const request = ++catalogRequest.current;
    setCatalogLoading(true); setCatalogError('');
    try {
      const next = await api.hermesModelCatalog(undefined, options);
      if (request === catalogRequest.current) setCatalog(next);
    } catch (e) {
      if (request === catalogRequest.current) setCatalogError('Could not refresh models. Try again.');
    } finally {
      if (request === catalogRequest.current) setCatalogLoading(false);
    }
  };
  const loadStatus = async (options: { freshAuth?: boolean } = {}) => {
    const request = ++statusRequest.current;
    try {
      const s = await api.hermesStatus(options);
      if (request !== statusRequest.current) return;
      setStatus(s);
      setModel(current => {
        const next = applySavedModelIfClean(current, s, modelDirty.current);
        if (next !== current) setCustomMode(false);
        return next;
      });
      setError('');
    } catch (e) { if (request === statusRequest.current) setError(errorText(e)); }
  };
  useEffect(() => { loadCatalog(); }, []);
  useEffect(() => { if (!appState.runtime.starting) void loadStatus({ freshAuth: true }); }, [appState.runtime.starting]);

  const currentCatalog = providerCatalog(catalog, model.provider);
  const listedModels = currentCatalog?.models || [];
  const shortlistModels = catalogRecommendedModels(listedModels, model.provider);
  const visibleModels = showAllModels ? listedModels : shortlistModels;
  const modelIsVisible = visibleModels.some(m => m.id === model.default);
  const showCurrentOption = !customMode && Boolean(model.default) && !modelIsVisible;
  const modelSelectValue = customMode ? CUSTOM : model.default;

  const runtimeSummary = useMemo(() => {
    const health = runtimeHealth(status, null, Boolean(status || error));
    if (status?.runtime.running) return { text: 'running', detail: 'CEO is on.', on: true, canStart: false };
    return { text: health.label, detail: `${health.message} ${health.next}`.trim(), on: false, canStart: health.canStart };
  }, [status, error]);
  const accountSummary = useMemo(() => {
    const auth = authForProvider(status, model.provider);
    const providerName = PROVIDERS.find(p => p.id === model.provider)?.name || model.provider;
    if (!status || auth?.native?.checked === false || auth?.native?.state === 'not_checked') return `Checking ${providerName}…`;
    if (!status.runtime.running) return `${providerName} unavailable.`;
    if (auth?.authenticated) return `${providerName} connected.`;
    if (auth?.credentialPresent) return `${providerName} credential saved.`;
    return `${providerName} not connected.`;
  }, [status, model.provider]);
  const saveModelSettings = async () => {
    const savedRevision = modelRevision.current;
    setBusy('model'); setError('');
    try {
      const saved = await api.saveModel(model);
      if (savedRevision === modelRevision.current) {
        const provider = saved.model.provider as Provider;
        modelDirty.current = false;
        setModel({ provider, default: saved.model.default, base_url: saved.model.base_url || '', api_mode: saved.model.api_mode || DEFAULTS[provider].api_mode });
        setCustomMode(false);
      }
      await loadStatus();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };
  const switchProvider = (provider: Provider) => {
    const cat = providerCatalog(catalog, provider);
    const fallback = DEFAULTS[provider];
    markModelDirty();
    setCustomMode(false);
    setShowAllModels(false);
    setModel(m => ({ ...m, provider, default: defaultModelForProvider(provider, cat), api_mode: cat?.api_mode || fallback.api_mode, base_url: '' }));
  };

  return (
    <div className="page" style={{ maxWidth: 1040, gap: 20 }}>
      <WorkspaceHead title="Settings" lede="Organization, runtime, and model selection." />
      {error && <div className="card" role="alert" style={{ padding: 12, borderColor: 'var(--border-6)', color: 'var(--text)' }}>{error}</div>}

      <OrganizationSettings />

      <div className="settings-grid">
        <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="CEO runtime">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={providerIconStyle}>CEO</div>
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              <h2 style={cardTitleStyle}>Waypoint CEO</h2>
              <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>Local Hermes runtime</div>
            </div>
            <StatusPill on={runtimeSummary.on}>{runtimeSummary.text}</StatusPill>
          </div>
          <div className="stack" style={{ gap: 6, color: 'var(--muted)', fontSize: 12.5 }}>
            <div>{runtimeSummary.detail}</div>
            <div>{accountSummary}</div>
            {status?.diagnostics?.message && <div role="status" style={{ color: 'var(--text)' }}>{status.diagnostics.message}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {runtimeSummary.canStart && <StartCeoButton className="btn btn-primary" />}
            <button className="btn btn-ghost" disabled={!!busy || appState.runtime.starting} onClick={() => loadStatus({ freshAuth: true })}>Refresh status</button>
          </div>
          {appState.runtime.startError && <div role="alert" className="form-error">{appState.runtime.startError}</div>}
        </section>

        <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="Connections shortcut">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={providerIconStyle}>AI</div>
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              <h2 style={cardTitleStyle}>Provider connections</h2>
              <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>Sign in and API keys live in Connectors.</div>
            </div>
          </div>
          <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/connectors')}>Open Connectors</button>
        </section>
      </div>

      <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="Model selection">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={cardTitleStyle}>Model</h2>
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>{status?.model.configured ? 'Saved' : 'Not saved'}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
          <label className="stack" style={labelStyle}>Provider
            <select value={model.provider} onChange={e => switchProvider(e.target.value as Provider)} style={inputStyle} disabled={busy === 'model'}>{PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="stack" style={labelStyle}>Model
            <select value={modelSelectValue} onChange={e => { markModelDirty(); if (e.target.value !== CUSTOM) { setCustomMode(false); setModel(m => ({ ...m, default: e.target.value })); } else { setCustomMode(true); setAdvanced(true); } }} style={inputStyle} disabled={busy === 'model' || (catalogLoading && !listedModels.length)}>
              {showCurrentOption && <option value={model.default}>Current: {model.default}</option>}
              {visibleModels.map(m => <option key={m.id} value={m.id}>{optionLabel(m, model.provider)}</option>)}
              <option value={CUSTOM}>Advanced custom model…</option>
            </select>
          </label>
          {advanced && <label className="stack" style={labelStyle}>Custom model
            <input value={model.default} onChange={e => { markModelDirty(); setModel(m => ({ ...m, default: e.target.value })); }} style={inputStyle} placeholder="provider model id" disabled={busy === 'model'} />
          </label>}
          {advanced && <label className="stack" style={labelStyle}>API mode
            <input value={model.api_mode} onChange={e => { markModelDirty(); setModel(m => ({ ...m, api_mode: e.target.value })); }} style={inputStyle} placeholder="optional" disabled={busy === 'model'} />
          </label>}
          {advanced && <label className="stack" style={labelStyle}>Base URL
            <input value={model.base_url} onChange={e => { markModelDirty(); setModel(m => ({ ...m, base_url: e.target.value })); }} style={inputStyle} placeholder="optional" disabled={busy === 'model'} />
          </label>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!!busy} onClick={saveModelSettings}>Save model</button>
          <button className="btn btn-ghost" disabled={!listedModels.length} onClick={() => setShowAllModels(v => !v)}>{showAllModels ? 'Show recommended' : 'Show all models'}</button>
          <button className="btn btn-ghost" disabled={catalogLoading} onClick={() => loadCatalog({ refresh: true })}>Refresh models</button>
          <button className="btn btn-ghost" onClick={() => setAdvanced(v => !v)}>{advanced ? 'Hide advanced' : 'Advanced'}</button>
        </div>
        <div style={{ fontSize: 12, color: catalogError ? 'var(--text)' : 'var(--faint)' }}>{catalogLoading ? 'Loading models…' : catalogError ? catalogError : 'Choose a model.'}</div>
      </section>
    </div>
  );
}

function StatusPill({ on, children }: { on: boolean; children: string }) {
  return <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border-3)', borderRadius: 999, padding: '3px 8px', color: on ? 'var(--text-3)' : 'var(--faint)', fontSize: 12 }}><OnDot on={on} />{children}</span>;
}

const inputStyle = { background: 'var(--well)', border: '1px solid var(--border-3)', borderRadius: 7, color: 'var(--text)', padding: '8px 10px', font: '400 12.5px var(--mono)' } as const;
const labelStyle = { gap: 6, fontSize: 12, color: 'var(--muted)' } as const;
const cardTitleStyle = { margin: 0, fontSize: 14, fontWeight: 600 } as const;
const providerIconStyle = { width: 34, height: 34, borderRadius: 10, border: '1px solid var(--border-3)', background: 'var(--hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 11px var(--mono)', color: 'var(--text-4)' } as const;
