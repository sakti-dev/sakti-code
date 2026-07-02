import { createEffect, createRoot, createSignal } from "solid-js";

export type PageType = "home" | "settings";

export interface WorkspaceTab {
  projectId: string | null;
  sessionId: string | null;
  page?: PageType;
}

const STORAGE_KEY = "sakti-workspace-tabs";

interface StoredState {
  activeIndex: number;
  tabs: WorkspaceTab[];
}

function loadFromStorage(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return seedState();
    }
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    const tabs = parsed.tabs;
    if (!Array.isArray(tabs) || tabs.length === 0) {
      return seedState();
    }
    const validated: WorkspaceTab[] = tabs.map((t) => ({
      projectId: t?.projectId ?? null,
      sessionId: t?.sessionId ?? null,
      ...(t?.page !== undefined ? { page: t.page as PageType } : {}),
    }));
    const activeIndex = Math.min(Math.max(0, parsed.activeIndex ?? 0), validated.length - 1);
    return { tabs: validated, activeIndex };
  } catch {
    return seedState();
  }
}

function seedState(): StoredState {
  return { tabs: [{ projectId: null, sessionId: null }], activeIndex: 0 };
}

function saveToStorage(tabs: WorkspaceTab[], activeIndex: number): void {
  try {
    const data: StoredState & { version: number } = {
      version: 1,
      tabs,
      activeIndex,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable — non-fatal
  }
}

const initial = loadFromStorage();

const [openTabs, setOpenTabs] = createSignal<WorkspaceTab[]>(initial.tabs);
const [activeTabIndex, setActiveTabIndex] = createSignal<number>(initial.activeIndex);

createRoot(() => {
  createEffect(() => {
    saveToStorage(openTabs(), activeTabIndex());
  });
});

function updateTab(index: number, patch: Partial<WorkspaceTab>): void {
  setOpenTabs((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
}

export function activeTab(): WorkspaceTab | null {
  const tabs = openTabs();
  const idx = activeTabIndex();
  if (idx < 0 || idx >= tabs.length) {
    return null;
  }
  return tabs[idx] ?? null;
}

export function openProjectTab(projectId: string, sessionId: string | null = null): void {
  const tabs = openTabs();

  const existingIdx = tabs.findIndex((t) => t.projectId === projectId);
  if (existingIdx >= 0) {
    setActiveTabIndex(existingIdx);
    if (sessionId !== null) {
      updateTab(existingIdx, { sessionId });
    }
    return;
  }

  const idx = activeTabIndex();
  if (idx >= 0 && idx < tabs.length && tabs[idx]?.projectId === null) {
    updateTab(idx, { projectId, sessionId });
    return;
  }

  const newIdx = tabs.length;
  setOpenTabs([...tabs, { projectId, sessionId }]);
  setActiveTabIndex(newIdx);
}

export function newTab(): void {
  const tabs = openTabs();
  setOpenTabs([...tabs, { projectId: null, sessionId: null }]);
  setActiveTabIndex(tabs.length);
}

export function openSettingsTab(): void {
  const tabs = openTabs();
  const existingIdx = tabs.findIndex((t) => t.page === "settings");
  if (existingIdx >= 0) {
    setActiveTabIndex(existingIdx);
    return;
  }
  const newIdx = tabs.length;
  setOpenTabs([...tabs, { projectId: null, sessionId: null, page: "settings" }]);
  setActiveTabIndex(newIdx);
}

export function transformTab(
  index: number,
  projectId: string,
  sessionId: string | null = null,
): void {
  const tabs = openTabs();

  const existingIdx = tabs.findIndex((t) => t.projectId === projectId);
  if (existingIdx >= 0 && existingIdx !== index) {
    const filtered = tabs.filter((_, i) => i !== index);
    const adjustedActive = existingIdx > index ? existingIdx - 1 : existingIdx;
    setOpenTabs(filtered);
    setActiveTabIndex(adjustedActive);
    return;
  }

  updateTab(index, { projectId, sessionId });
}

export function closeTab(index: number): void {
  const tabs = openTabs();
  if (index < 0 || index >= tabs.length) {
    return;
  }

  const newTabs = tabs.filter((_, i) => i !== index);

  if (newTabs.length === 0) {
    setOpenTabs([{ projectId: null, sessionId: null }]);
    setActiveTabIndex(0);
    return;
  }

  const currentActive = activeTabIndex();
  let newActive = currentActive;

  if (index === currentActive) {
    newActive = Math.min(index, newTabs.length - 1);
  } else if (index < currentActive) {
    newActive = currentActive - 1;
  }

  setOpenTabs(newTabs);
  setActiveTabIndex(newActive);
}

export function switchTab(index: number): void {
  const tabs = openTabs();
  if (index >= 0 && index < tabs.length) {
    setActiveTabIndex(index);
  }
}

export function setTabSession(projectId: string, sessionId: string | null): void {
  const tabs = openTabs();
  const idx = tabs.findIndex((t) => t.projectId === projectId);
  if (idx >= 0) {
    updateTab(idx, { sessionId });
  }
}

export function filterStaleProjects(validProjectIds: Set<string>): void {
  const tabs = openTabs();
  let changed = false;
  const newTabs = tabs.map((t) => {
    if (t.projectId !== null && !validProjectIds.has(t.projectId)) {
      changed = true;
      return { projectId: null, sessionId: null };
    }
    return t;
  });

  if (changed) {
    setOpenTabs(newTabs);
    const idx = activeTabIndex();
    if (idx >= newTabs.length) {
      setActiveTabIndex(Math.max(0, newTabs.length - 1));
    }
  }
}

export { activeTabIndex, openTabs };
