import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type MissionInput } from './api';
import { ceoLoadFailed, ceoLoadStarted, ceoLoadSucceeded, ceoSendFailed, ceoSendStarted, ceoSendSucceeded, cleanCeoMessage, emptyCeoState, type CeoState } from './ceoConversation';
import type { LessonPick } from './data';
import { liveTasks, pendingInbox, type Resolved } from './model';
import { initialMissionsState, missionsLoadFailed, missionsLoadStarted, missionsLoadSucceeded, type MissionsState } from './missionsModel';

export type PaneTab = 'ceo' | 'tasks' | 'artifacts' | 'inbox' | 'item';
export type ModalKind = 'assignment' | 'mission' | 'pod' | 'seat';

export interface AppState {
  pane: { open: boolean; tab: PaneTab; item: string | null };
  resolved: Resolved;
  picks: Record<string, LessonPick>;
  seat: string;
  podStopped: boolean;
  missionOpen: boolean;
  routinesOff: Record<string, boolean>;
  connected: Record<string, boolean>;
  ceo: CeoState;
  missions: MissionsState;
  modal: ModalKind | null;
  toast: string | null;
}

const STORAGE_KEY = 'waypoint-web';
const PERSISTED = ['pane', 'missionOpen'] as const;

function cleanPane(saved: Partial<AppState>): AppState['pane'] {
  const fallback: AppState['pane'] = { open: window.innerWidth >= 1280, tab: 'ceo', item: null };
  const pane = saved.pane && typeof saved.pane === 'object' ? saved.pane : fallback;
  const tab = pane.tab === 'item' ? 'ceo' : (pane.tab || fallback.tab);
  return { open: typeof pane.open === 'boolean' ? pane.open : fallback.open, tab, item: null };
}

function initialState(): AppState {
  let saved: Partial<AppState> = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* ignore */ }
  return {
    pane: cleanPane(saved),
    resolved: {}, picks: {}, seat: '', podStopped: false, missionOpen: Boolean(saved.missionOpen), routinesOff: {}, connected: {},
    ceo: emptyCeoState, missions: initialMissionsState, modal: null, toast: null,
  };
}

type Update = Partial<AppState> | ((s: AppState) => Partial<AppState>);

function useAppStore() {
  const [state, setRaw] = useState(initialState);
  const set = useCallback((u: Update) => setRaw(s => ({ ...s, ...(typeof u === 'function' ? u(s) : u) })), []);

  useEffect(() => {
    const out: Record<string, unknown> = {};
    for (const k of PERSISTED) out[k] = state[k];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch { /* ignore */ }
  }, [state]);

  const toastTimer = useRef<number>();
  const ceoSendingRef = useRef(false);
  const ceoSendVersionRef = useRef(0);
  const actions = useMemo(() => ({
    set,
    setPane: (p: Partial<AppState['pane']>) => set(s => ({ pane: { ...s.pane, ...p } })),
    resolve: (id: string, v: 'yes' | 'no') => set(s => ({ resolved: { ...s.resolved, [id]: v } })),
    openModal: (m: ModalKind) => set({ modal: m }),
    closeModal: () => set({ modal: null }),
    flash: (msg: string) => {
      set({ toast: msg });
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => set({ toast: null }), 2600);
    },
    loadMissions: async () => {
      set(s => ({ missions: missionsLoadStarted(s.missions) }));
      try {
        const { missions } = await api.missions();
        set({ missions: missionsLoadSucceeded(missions) });
      } catch (err) {
        set(s => ({ missions: missionsLoadFailed(s.missions, err instanceof Error ? err.message : String(err)) }));
      }
    },
    /** Saves a mission on the service, then reloads the list so every view shows the stored record. */
    createMission: async (input: MissionInput) => {
      try {
        await api.createMission(input);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      try {
        const { missions } = await api.missions();
        set({ missions: missionsLoadSucceeded(missions) });
      } catch (err) {
        set(s => ({ missions: missionsLoadFailed(s.missions, err instanceof Error ? err.message : String(err)) }));
      }
      return { ok: true };
    },
    loadCeoConversation: async () => {
      const sendVersion = ceoSendVersionRef.current;
      set(s => ({ ceo: ceoLoadStarted(s.ceo) }));
      try {
        const conversation = await api.ceoConversation();
        set(s => ceoSendVersionRef.current === sendVersion ? { ceo: ceoLoadSucceeded(s.ceo, conversation) } : {});
      } catch (err) {
        set(s => ceoSendVersionRef.current === sendVersion ? { ceo: ceoLoadFailed(s.ceo, err instanceof Error ? err.message : String(err)) } : {});
      }
    },
    sendCeoMessage: async (message: string, openPane = false) => {
      const text = cleanCeoMessage(message);
      if (!text) return { ok: false, error: 'Message is empty' };
      if (ceoSendingRef.current) return { ok: false, error: 'A CEO message is already sending' };
      ceoSendingRef.current = true;
      ceoSendVersionRef.current += 1;
      set(s => ({
        ceo: ceoSendStarted(s.ceo, text),
        ...(openPane ? { pane: { ...s.pane, open: true, tab: 'ceo' as const } } : {}),
      }));
      try {
        const response = await api.sendCeoMessage(text);
        set(s => ({ ceo: ceoSendSucceeded(s.ceo, response), ...(openPane ? { pane: { ...s.pane, open: true, tab: 'ceo' as const } } : {}) }));
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set(s => ({ ceo: ceoSendFailed(s.ceo, message) }));
        return { ok: false, error: message };
      } finally {
        ceoSendingRef.current = false;
      }
    },
  }), [set]);

  // Missions come from the local service; load once when the app opens.
  useEffect(() => { void actions.loadMissions(); }, [actions]);

  const derived = useMemo(() => ({
    tasks: liveTasks(state.resolved),
    pending: pendingInbox(state.resolved),
  }), [state.resolved]);

  return { state, ...derived, ...actions };
}

type Store = ReturnType<typeof useAppStore>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useAppStore();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

export function useViewport() {
  const [vw, setVw] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vw;
}
