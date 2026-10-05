import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatEntry, LessonPick } from './data';
import { clock, liveTasks, pendingInbox, type Resolved } from './model';

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
  chatExtra: ChatEntry[];
  typing: boolean;
  modal: ModalKind | null;
  toast: string | null;
}

const STORAGE_KEY = 'waypoint-web';
const PERSISTED = ['pane', 'resolved', 'picks', 'seat', 'podStopped', 'missionOpen', 'routinesOff', 'connected'] as const;

function initialState(): AppState {
  let saved: Partial<AppState> = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* ignore */ }
  return {
    pane: { open: window.innerWidth >= 1280, tab: 'ceo', item: null },
    resolved: {}, picks: {}, seat: 'frontend-2', podStopped: false, missionOpen: false, routinesOff: {}, connected: {},
    ...saved,
    chatExtra: [], typing: false, modal: null, toast: null,
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
    /** Posts the user's message, then a canned CEO reply after a short "planning" pause. */
    askCeo: (text: string, reply: () => ChatEntry[], openPane = false) => {
      const time = clock();
      set(s => ({ typing: true, chatExtra: [...s.chatExtra, { who: 'you', text, time }], ...(openPane ? { pane: { ...s.pane, open: true, tab: 'ceo' as const } } : {}) }));
      window.setTimeout(() => set(s => ({ typing: false, chatExtra: [...s.chatExtra, ...reply()] })), 1300);
    },
  }), [set]);

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
