import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type HermesStatus, type BoardTask, type Pod, type MissionInput, type OrganizationInput, type OrganizationState, type Project } from './api';
import { createdBoardTask, ceoLiveUpdated, ceoLoadFailed, ceoLoadStarted, ceoLoadSucceeded, ceoSendFailed, ceoSendStarted, ceoSendSucceeded, cleanCeoMessage, emptyCeoState, type CeoState } from './ceoConversation';
import type { LessonPick } from './data';
import { liveTasks, pendingInbox, type Resolved } from './model';
import { mergeStatus, START_TIMEOUT_MS, startFailureText, errorText } from './runtimeHealth';
import { initialMissionsState, missionsLoadFailed, missionsLoadStarted, missionsLoadSucceeded, type MissionsState } from './missionsModel';

export type PaneTab = 'ceo' | 'tasks' | 'artifacts' | 'inbox' | 'item';
export type ModalKind = 'assignment' | 'mission' | 'seat' | 'project' | 'pod';

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
  ceoThread: string;
  missions: MissionsState;
  projects: Project[];
  pods: Pod[];
  board: BoardTask[];
  projectMission: string | null;
  org: OrganizationState & { loaded: boolean; error?: string };
  runtime: { status: HermesStatus | null; error: unknown; checked: boolean; starting: boolean; startError: string };
  modal: ModalKind | null;
  toast: string | null;
}

const STORAGE_KEY = 'waypoint-web';
const PERSISTED = ['pane', 'missionOpen', 'ceoThread'] as const;

function cleanPane(saved: Partial<AppState>): AppState['pane'] {
  const fallback: AppState['pane'] = { open: window.innerWidth >= 1280, tab: 'ceo', item: null };
  const pane = saved.pane && typeof saved.pane === 'object' ? saved.pane : fallback;
  const tab = pane.tab === 'item' ? 'ceo' : (pane.tab || fallback.tab);
  return { open: typeof pane.open === 'boolean' ? pane.open : fallback.open, tab, item: null };
}

function initialState(): AppState {
  let saved: Partial<AppState> = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {   }
  return {
    pane: cleanPane(saved),
    resolved: {}, picks: {}, seat: '', podStopped: false, missionOpen: Boolean(saved.missionOpen), routinesOff: {}, connected: {},
    ceo: emptyCeoState, ceoThread: typeof saved.ceoThread === 'string' && saved.ceoThread ? saved.ceoThread : 'general', missions: initialMissionsState, projects: [], pods: [], board: [], projectMission: null, org: { loaded: false, configured: false, organization: null }, runtime: { status: null, error: null, checked: false, starting: false, startError: '' }, modal: null, toast: null,
  };
}

type Update = Partial<AppState> | ((s: AppState) => Partial<AppState>);

function useAppStore() {
  const [state, setRaw] = useState(initialState);
  const set = useCallback((u: Update) => setRaw(s => ({ ...s, ...(typeof u === 'function' ? u(s) : u) })), []);

  useEffect(() => {
    const out: Record<string, unknown> = {};
    for (const k of PERSISTED) out[k] = state[k];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch {   }
  }, [state]);

  const toastTimer = useRef<number>();
  const ceoSendingRef = useRef(false);
  const ceoSendVersionRef = useRef(0);
  const ceoThreadRef = useRef(state.ceoThread);
  ceoThreadRef.current = state.ceoThread;
  const actions = useMemo(() => ({
    set,
    setPane: (p: Partial<AppState['pane']>) => set(s => ({ pane: { ...s.pane, ...p } })),
    resolve: (id: string, v: 'yes' | 'no') => set(s => ({ resolved: { ...s.resolved, [id]: v } })),
    openModal: (m: ModalKind) => set({ modal: m }),
    closeModal: () => set({ modal: null, projectMission: null }),
    addProject: (missionId: string) => set({ modal: 'project', projectMission: missionId }),
    flash: (msg: string) => {
      set({ toast: msg });
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => set({ toast: null }), 2600);
    },
    loadOrganization: async () => {
      try {
        const org = await api.organization();
        set({ org: { ...org, loaded: true } });
      } catch (err) {
        set(s => ({ org: { ...s.org, loaded: true, error: errorText(err) } }));
      }
    },
    saveOrganization: async (input: OrganizationInput) => {
      const org = await api.saveOrganization(input);
      set({ org: { ...org, loaded: true } });
      return org;
    },
    refreshRuntime: async (fresh = false) => {
      try {
        const next = await api.hermesStatus({ freshAuth: fresh });
        set(s => ({ runtime: { ...s.runtime, status: mergeStatus(s.runtime.status, next), error: null, checked: true } }));
        return next;
      } catch (error) {
        set(s => ({ runtime: { ...s.runtime, status: null, error, checked: true } }));
        return null;
      }
    },
    startCeo: async () => {
      set(s => ({ runtime: { ...s.runtime, starting: true, startError: '' } }));
      let timer = 0;
      const timedOut = new Promise<'timeout'>(resolve => { timer = window.setTimeout(() => resolve('timeout'), START_TIMEOUT_MS); });
      try {
        const result = await Promise.race([api.hermesLifecycle('start'), timedOut]);
        if (result === 'timeout') set(s => ({ runtime: { ...s.runtime, startError: startFailureText(null, true) } }));
      } catch (error) {
        set(s => ({ runtime: { ...s.runtime, startError: startFailureText(error, false) } }));
      } finally {
        window.clearTimeout(timer);
        const next = await api.hermesStatus({ freshAuth: true }).catch(() => null);
        set(s => ({ runtime: { ...s.runtime, starting: false, ...(next ? { status: next, error: null, checked: true } : {}) } }));
      }
    },
    loadBoard: async () => {
      try {
        const { tasks } = await api.tasks();
        set(s => JSON.stringify(s.board) === JSON.stringify(tasks) ? {} : { board: tasks });
        return tasks;
      } catch { return null; }
    },
    loadPods: async () => {
      try { set({ pods: (await api.pods()).pods }); } catch {   }
    },
    loadProjects: async () => {
      try { set({ projects: (await api.projects()).projects }); } catch {   }
    },
    loadMissions: async () => {
      set(s => ({ missions: missionsLoadStarted(s.missions) }));
      try {
        const { missions } = await api.missions();
        set({ missions: missionsLoadSucceeded(missions) });
      } catch (err) {
        set(s => ({ missions: missionsLoadFailed(s.missions, errorText(err)) }));
      }
    },

    createMission: async (input: MissionInput) => {
      try {
        await api.createMission(input);
      } catch (err) {
        return { ok: false, error: errorText(err) };
      }
      try {
        const { missions } = await api.missions();
        set({ missions: missionsLoadSucceeded(missions) });
      } catch (err) {
        set(s => ({ missions: missionsLoadFailed(s.missions, errorText(err)) }));
      }
      return { ok: true };
    },
    loadCeoConversation: async () => {
      const sendVersion = ceoSendVersionRef.current;
      const thread = ceoThreadRef.current;
      set(s => ({ ceo: ceoLoadStarted(s.ceo) }));
      try {
        const conversation = await api.ceoConversation(thread);
        set(s => ceoSendVersionRef.current === sendVersion && s.ceoThread === thread ? { ceo: ceoLoadSucceeded(s.ceo, conversation) } : {});
      } catch (err) {
        set(s => ceoSendVersionRef.current === sendVersion && s.ceoThread === thread ? { ceo: ceoLoadFailed(s.ceo, errorText(err)) } : {});
      }
    },
    setCeoThread: (thread: string) => {
      if (thread === ceoThreadRef.current) return false;
      ceoThreadRef.current = thread;
      ceoSendVersionRef.current += 1;
      set({ ceoThread: thread, ceo: { ...emptyCeoState, loading: true } });
      void api.ceoConversation(thread)
        .then(conversation => set(s => s.ceoThread === thread ? { ceo: ceoLoadSucceeded(s.ceo, conversation) } : {}))
        .catch(err => set(s => s.ceoThread === thread ? { ceo: ceoLoadFailed(s.ceo, errorText(err)) } : {}));
      return true;
    },
    sendCeoMessage: async (message: string, openPane = false, onTaskCreated?: (ref: string) => void) => {
      const text = cleanCeoMessage(message);
      if (!text) return { ok: false, error: 'Message is empty' };
      if (ceoSendingRef.current) return { ok: false, error: 'A CEO message is already sending' };
      ceoSendingRef.current = true;
      ceoSendVersionRef.current += 1;
      const thread = ceoThreadRef.current;
      let followed = false;
      const known = onTaskCreated ? api.tasks().then(r => new Set(r.tasks.map(t => t.id))).catch(() => null) : null;
      const followCreated = async () => {
        if (followed || !known) return;
        followed = true;
        const [before, after] = await Promise.all([known, actions.loadBoard()]);
        const created = before && after?.find(t => !before.has(t.id));
        if (created) onTaskCreated?.(created.ref || created.id);
        else followed = false;
      };
      const follow = (items: Parameters<typeof createdBoardTask>[0]) => { if (createdBoardTask(items)) void followCreated(); };
      const poll = window.setInterval(() => {
        void api.ceoConversation(thread).then(conversation => {
          follow(conversation.live?.items);
          set(s => s.ceoThread === thread && s.ceo.sending ? { ceo: ceoLiveUpdated(s.ceo, conversation) } : {});
        }).catch(() => undefined);
      }, 1500);
      set(s => ({
        ceo: ceoSendStarted(s.ceo, text),
        ...(openPane ? { pane: { ...s.pane, open: true, tab: 'ceo' as const } } : {}),
      }));
      try {
        const response = await api.sendCeoMessage(text, thread);
        await followCreated();
        void actions.loadBoard();
        void actions.loadMissions();
        void actions.loadPods();
        set(s => ({ ceo: s.ceoThread === thread ? ceoSendSucceeded(s.ceo, response) : { ...s.ceo, busyThreadId: null }, ...(openPane ? { pane: { ...s.pane, open: true, tab: 'ceo' as const } } : {}) }));
        return { ok: true };
      } catch (err) {
        const message = errorText(err);
        set(s => ({ ceo: s.ceoThread === thread ? ceoSendFailed(s.ceo, message) : { ...s.ceo, busyThreadId: null } }));
        return { ok: false, error: message };
      } finally {
        window.clearInterval(poll);
        ceoSendingRef.current = false;
      }
    },
  }), [set]);

  useEffect(() => { void actions.loadMissions(); void actions.loadOrganization(); void actions.loadProjects(); void actions.loadPods(); void actions.refreshRuntime(true); }, [actions]);
  useEffect(() => {
    const timer = window.setInterval(() => void actions.refreshRuntime(), 15000);
    return () => window.clearInterval(timer);
  }, [actions]);

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
