import { createEffect, createRoot, createSignal } from "solid-js";

export type PageType = "settings";

export interface ProjectTab {
  projectId: string | null;
  sessionId: string | null;
  page?: PageType;
}

const STORAGE_KEY = "sakti-project-tabs";

interface StoredState {
  activeIndex: number;
  tabs: ProjectTab[];
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
    const validated: ProjectTab[] = tabs.map((t) => ({
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

function saveToStorage(tabs: ProjectTab[], activeIndex: number): void {
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

const [projectTabs, setProjectTabs] = createSignal<ProjectTab[]>(initial.tabs);
const [activeProjectIndex, setActiveProjectIndex] = createSignal<number>(initial.activeIndex);

createRoot(() => {
  createEffect(() => {
    saveToStorage(projectTabs(), activeProjectIndex());
  });
});

function updateTab(index: number, patch: Partial<ProjectTab>): void {
  setProjectTabs((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
}

export function activeProjectTab(): ProjectTab | null {
  const tabs = projectTabs();
  const idx = activeProjectIndex();
  if (idx < 0 || idx >= tabs.length) {
    return null;
  }
  return tabs[idx] ?? null;
}

export function openProjectTab(projectId: string): void {
  const tabs = projectTabs();

  const existingIdx = tabs.findIndex((t) => t.projectId === projectId);
  if (existingIdx >= 0) {
    setActiveProjectIndex(existingIdx);
    return;
  }

  const idx = activeProjectIndex();
  if (idx >= 0 && idx < tabs.length && tabs[idx]?.projectId === null) {
    updateTab(idx, { projectId });
    return;
  }

  const newIdx = tabs.length;
  setProjectTabs([...tabs, { projectId, sessionId: null }]);
  setActiveProjectIndex(newIdx);
}

export function newProjectTab(): void {
  const tabs = projectTabs();
  setProjectTabs([...tabs, { projectId: null, sessionId: null }]);
  setActiveProjectIndex(tabs.length);
}

export function openSettingsTab(): void {
  const tabs = projectTabs();
  const existingIdx = tabs.findIndex((t) => t.page === "settings");
  if (existingIdx >= 0) {
    setActiveProjectIndex(existingIdx);
    return;
  }
  const newIdx = tabs.length;
  setProjectTabs([...tabs, { projectId: null, sessionId: null, page: "settings" }]);
  setActiveProjectIndex(newIdx);
}

export function transformProjectTab(index: number, projectId: string): void {
  const tabs = projectTabs();

  const existingIdx = tabs.findIndex((t) => t.projectId === projectId);
  if (existingIdx >= 0 && existingIdx !== index) {
    const filtered = tabs.filter((_, i) => i !== index);
    const adjustedActive = existingIdx > index ? existingIdx - 1 : existingIdx;
    setProjectTabs(filtered);
    setActiveProjectIndex(adjustedActive);
    return;
  }

  updateTab(index, { projectId });
}

export function closeProjectTab(index: number): void {
  const tabs = projectTabs();
  if (index < 0 || index >= tabs.length) {
    return;
  }

  const newTabs = tabs.filter((_, i) => i !== index);

  if (newTabs.length === 0) {
    setProjectTabs([{ projectId: null, sessionId: null }]);
    setActiveProjectIndex(0);
    return;
  }

  const currentActive = activeProjectIndex();
  let newActive = currentActive;

  if (index === currentActive) {
    newActive = Math.min(index, newTabs.length - 1);
  } else if (index < currentActive) {
    newActive = currentActive - 1;
  }

  setProjectTabs(newTabs);
  setActiveProjectIndex(newActive);
}

export function switchProjectTab(index: number): void {
  const tabs = projectTabs();
  if (index >= 0 && index < tabs.length) {
    setActiveProjectIndex(index);
  }
}

export function setTabSession(projectId: string, sessionId: string | null): void {
  const tabs = projectTabs();
  const idx = tabs.findIndex((t) => t.projectId === projectId);
  if (idx >= 0) {
    updateTab(idx, { sessionId });
  }
}

export function filterStaleProjects(validProjectIds: Set<string>): void {
  const tabs = projectTabs();
  let changed = false;
  const newTabs = tabs.map((t) => {
    if (t.projectId !== null && !validProjectIds.has(t.projectId)) {
      changed = true;
      return { projectId: null, sessionId: null };
    }
    return t;
  });

  if (changed) {
    setProjectTabs(newTabs);
    const idx = activeProjectIndex();
    if (idx >= newTabs.length) {
      setActiveProjectIndex(Math.max(0, newTabs.length - 1));
    }
  }
}

export { activeProjectIndex, projectTabs };
