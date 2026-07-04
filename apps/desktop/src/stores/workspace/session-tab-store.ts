import { createSignal } from "solid-js";

export type SessionTabKind = "home" | "intake" | "mission";

export interface SessionTab {
  kind: SessionTabKind;
  sessionId: string | null;
}

interface ProjectTabStrip {
  tabs: SessionTab[];
  activeIndex: number;
}

const STORAGE_KEY = "sakti-session-tabs";
const HOME_TAB: SessionTab = { kind: "home", sessionId: null };

function loadFromStorage(): Record<string, ProjectTabStrip> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ProjectTabStrip>;
    for (const [pid, state] of Object.entries(parsed)) {
      if (!state.tabs?.length || state.tabs[0]?.kind !== "home") {
        delete parsed[pid];
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveToStorage(data: Record<string, ProjectTabStrip>): void {
  try {
    const filtered: Record<string, ProjectTabStrip> = {};
    for (const [pid, state] of Object.entries(data)) {
      const realTabs = state.tabs.filter((t) => t.kind === "home" || t.sessionId !== null);
      if (realTabs.length === 0) continue;
      const activeIndex = Math.min(state.activeIndex, realTabs.length - 1);
      filtered[pid] = { tabs: realTabs, activeIndex };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // non-fatal
  }
}

const initial = loadFromStorage();
const [stripState, setStripState] = createSignal<Record<string, ProjectTabStrip>>(initial);

function persist(): void {
  saveToStorage(stripState());
}

function mutateProject(projectId: string, fn: (state: ProjectTabStrip) => ProjectTabStrip): void {
  setStripState((prev) => {
    const current = prev[projectId] ?? { tabs: [HOME_TAB], activeIndex: 0 };
    return { ...prev, [projectId]: fn(current) };
  });
}

export function ensureProjectTabs(projectId: string): void {
  setStripState((prev) => {
    if (prev[projectId]) return prev;
    return { ...prev, [projectId]: { tabs: [HOME_TAB], activeIndex: 0 } };
  });
}

export function getSessionTabs(projectId: string): SessionTab[] {
  return stripState()[projectId]?.tabs ?? [];
}

export function getActiveSessionIndex(projectId: string): number {
  return stripState()[projectId]?.activeIndex ?? 0;
}

export function getActiveSessionTab(projectId: string): SessionTab | null {
  const state = stripState()[projectId];
  if (!state) return null;
  return state.tabs[state.activeIndex] ?? null;
}

export function getSessionTabIndex(projectId: string, sessionId: string): number {
  const tabs = getSessionTabs(projectId);
  return tabs.findIndex((t) => t.sessionId === sessionId);
}

export function openSessionTab(projectId: string, sessionId: string, kind: SessionTabKind): void {
  ensureProjectTabs(projectId);
  mutateProject(projectId, (state) => {
    const existingIdx = state.tabs.findIndex((t) => t.sessionId === sessionId);
    if (existingIdx >= 0) {
      const tabs = state.tabs.map((t, i) => (i === existingIdx ? { ...t, kind } : t));
      return { tabs, activeIndex: existingIdx };
    }
    return {
      tabs: [...state.tabs, { kind, sessionId }],
      activeIndex: state.tabs.length,
    };
  });
}

export function openDraftIntakeTab(projectId: string): void {
  ensureProjectTabs(projectId);
  mutateProject(projectId, (state) => {
    return {
      tabs: [...state.tabs, { kind: "intake", sessionId: null }],
      activeIndex: state.tabs.length,
    };
  });
}

export function promoteDraftIntake(projectId: string, sessionId: string): void {
  mutateProject(projectId, (state) => {
    const idx = state.activeIndex;
    if (idx < 0 || idx >= state.tabs.length) return state;
    const tab = state.tabs[idx];
    if (!tab || tab.kind !== "intake" || tab.sessionId !== null) return state;
    const tabs = state.tabs.map((t, i) => (i === idx ? { ...t, sessionId } : t));
    return { ...state, tabs };
  });
  persist();
}

export function closeSessionTab(projectId: string, index: number): void {
  if (index === 0) return;
  mutateProject(projectId, (state) => {
    const newTabs = state.tabs.filter((_, i) => i !== index);
    let newActive = state.activeIndex;
    if (index === state.activeIndex) {
      newActive = Math.min(index, newTabs.length - 1);
    } else if (index < state.activeIndex) {
      newActive = state.activeIndex - 1;
    }
    return { tabs: newTabs, activeIndex: newActive };
  });
  persist();
}

export function switchSessionTab(projectId: string, index: number): void {
  mutateProject(projectId, (state) => {
    if (index < 0 || index >= state.tabs.length) return state;
    return { ...state, activeIndex: index };
  });
  persist();
}

export function filterStaleSessions(projectId: string, validSessionIds: Set<string>): void {
  mutateProject(projectId, (state) => {
    const newTabs = state.tabs.filter(
      (t) => t.kind === "home" || (t.sessionId !== null && validSessionIds.has(t.sessionId)),
    );
    if (newTabs.length === state.tabs.length) return state;
    const newActive = Math.min(state.activeIndex, newTabs.length - 1);
    return { tabs: newTabs, activeIndex: newActive };
  });
}
