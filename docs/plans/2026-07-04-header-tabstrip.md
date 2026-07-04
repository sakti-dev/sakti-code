# Header + Inner Tab Strip Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two-level tab navigation — project tabs (header) + session tabs (inner Chrome-style strip). Intake home becomes a non-closeable Home tab. Intakes open as tabs instead of inline overlays. Graduation closes the intake tab and opens a mission tab.

**Architecture:** Two independent stores: `project-tab-store` (top-level project tabs, renamed from `tab-store`) and `session-tab-store` (per-project inner working set of Home + intake/mission tabs). `OnboardingPanel` splits into `IntakeGrid` (Home tab content) and `IntakeChat` (intake tab content). Chrome-style curved tabs restored for the inner strip.

**Tech Stack:** SolidJS, solid-js signals (createRoot/createSignal), localStorage persistence, motion-solidjs for tab animation, vitest + @solidjs/testing-library for tests.

**Design doc:** `docs/plans/2026-07-04-header-tabstrip-design.md`

---

## Phase 1: session-tab-store.ts (new)

### Task 1: Create session-tab-store with tests

**Files:**

- Create: `apps/desktop/src/stores/workspace/session-tab-store.ts`
- Test: `apps/desktop/src/stores/workspace/__tests__/session-tab-store.test.ts`

**Step 1: Write the failing tests**

Create `apps/desktop/src/stores/workspace/__tests__/session-tab-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  closeSessionTab,
  filterStaleSessions,
  ensureProjectTabs,
  getActiveSessionIndex,
  getActiveSessionTab,
  getSessionTabs,
  openSessionTab,
  switchSessionTab,
  type SessionTab,
} from "../session-tab-store.ts";

const HOME: SessionTab = { kind: "home", sessionId: null };

describe("session-tab-store", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset module state by re-importing — vi.resetModules + dynamic import
  });

  describe("ensureProjectTabs", () => {
    it("creates a Home tab for a new project", () => {
      ensureProjectTabs("p1");
      expect(getSessionTabs("p1")).toEqual([HOME]);
      expect(getActiveSessionIndex("p1")).toBe(0);
    });

    it("does not duplicate if Home already exists", () => {
      ensureProjectTabs("p1");
      ensureProjectTabs("p1");
      expect(getSessionTabs("p1")).toEqual([HOME]);
    });
  });

  describe("openSessionTab", () => {
    it("adds an intake tab after Home", () => {
      ensureProjectTabs("p1");
      openSessionTab("p1", "s1", "intake");
      expect(getSessionTabs("p1")).toEqual([HOME, { kind: "intake", sessionId: "s1" }]);
      expect(getActiveSessionIndex("p1")).toBe(1);
    });

    it("activates existing tab instead of duplicating", () => {
      ensureProjectTabs("p1");
      openSessionTab("p1", "s1", "intake");
      openSessionTab("p1", "s2", "mission");
      openSessionTab("p1", "s1", "intake");
      expect(getSessionTabs("p1")).toHaveLength(3);
      expect(getActiveSessionIndex("p1")).toBe(1);
    });

    it("updates kind if session changes kind (intake → mission morph)", () => {
      ensureProjectTabs("p1");
      openSessionTab("p1", "s1", "intake");
      openSessionTab("p1", "s1", "mission");
      expect(getSessionTabs("p1")).toEqual([HOME, { kind: "mission", sessionId: "s1" }]);
    });
  });

  describe("closeSessionTab", () => {
    it("closes a non-Home tab", () => {
      ensureProjectTabs("p1");
      openSessionTab("p1", "s1", "intake");
      openSessionTab("p1", "s2", "mission");
      closeSessionTab("p1", 1);
      expect(getSessionTabs("p1")).toEqual([HOME, { kind: "mission", sessionId: "s2" }]);
    });

    it("does NOT close Home (index 0)", () => {
      ensureProjectTabs("p1");
      closeSessionTab("p1", 0);
      expect(getSessionTabs("p1")).toEqual([HOME]);
    });

    it("activates Home when closing the active tab", () => {
      ensureProjectTabs("p1");
      openSessionTab("p1", "s1", "intake");
      closeSessionTab("p1", 1);
      expect(getActiveSessionIndex("p1")).toBe(0);
    });

    it("adjusts active index when closing a tab before it", () => {
      ensureProjectTabs("p1");
      openSessionTab("p1", "s1", "intake");
      openSessionTab("p1", "s2", "mission");
      switchSessionTab("p1", 2);
      closeSessionTab("p1", 1);
      expect(getActiveSessionIndex("p1")).toBe(1);
    });
  });

  describe("switchSessionTab", () => {
    it("changes the active index", () => {
      ensureProjectTabs("p1");
      openSessionTab("p1", "s1", "intake");
      switchSessionTab("p1", 0);
      expect(getActiveSessionIndex("p1")).toBe(0);
      expect(getActiveSessionTab("p1")?.kind).toBe("home");
    });
  });

  describe("filterStaleSessions", () => {
    it("drops tabs whose sessionId no longer exists", () => {
      ensureProjectTabs("p1");
      openSessionTab("p1", "s1", "intake");
      openSessionTab("p1", "s2", "mission");
      filterStaleSessions("p1", new Set(["s2"]));
      expect(getSessionTabs("p1")).toEqual([HOME, { kind: "mission", sessionId: "s2" }]);
    });

    it("keeps Home regardless", () => {
      ensureProjectTabs("p1");
      filterStaleSessions("p1", new Set());
      expect(getSessionTabs("p1")).toEqual([HOME]);
    });
  });

  describe("getActiveSessionTab", () => {
    it("returns null for unknown project", () => {
      expect(getActiveSessionTab("nope")).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
vp run desktop#test src/stores/workspace/__tests__/session-tab-store.test.ts
```

Expected: FAIL — module not found / functions not exported.

**Step 3: Implement session-tab-store**

Create `apps/desktop/src/stores/workspace/session-tab-store.ts`:

```ts
import { createRoot, createSignal, createEffect } from "solid-js";

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

const initial = loadFromStorage();
const [stripState, setStripState] = createSignal<Record<string, ProjectTabStrip>>(initial);

createRoot(() => {
  createEffect(() => {
    saveToStorage(stripState());
  });
});

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
}

export function switchSessionTab(projectId: string, index: number): void {
  mutateProject(projectId, (state) => {
    if (index < 0 || index >= state.tabs.length) return state;
    return { ...state, activeIndex: index };
  });
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
```

**Step 4: Run tests to verify they pass**

```bash
vp run desktop#test src/stores/workspace/__tests__/session-tab-store.test.ts
```

Expected: PASS — all tests green.

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/workspace/session-tab-store.ts apps/desktop/src/stores/workspace/__tests__/session-tab-store.test.ts
git commit -m "feat(desktop): add session-tab-store for per-project inner tabs

New store managing a working set of Home + intake/mission tabs per
project. Home is always index 0, not closeable. Persists to localStorage."
```

---

## Phase 2: Rename tab-store → project-tab-store

### Task 2: Rename file + exports (keep sessionId for now)

This is a mechanical rename. The store's logic stays identical — only names change. `sessionId` stays on `ProjectTab` for now to avoid breakage; it's removed in Phase 6.

**Files:**

- Rename: `apps/desktop/src/stores/workspace/tab-store.ts` → `project-tab-store.ts`
- Modify all 6 consumers (see below)
- No existing tab-store tests to update

**Step 1: Rename the file and update exports**

Rename `apps/desktop/src/stores/workspace/tab-store.ts` → `project-tab-store.ts`.

In the file, apply these renames:

| Old                                           | New                                                         |
| --------------------------------------------- | ----------------------------------------------------------- |
| `PageType`                                    | (keep, but simplify to just `"settings"` — remove `"home"`) |
| `WorkspaceTab`                                | `ProjectTab`                                                |
| `STORAGE_KEY = "sakti-workspace-tabs"`        | `STORAGE_KEY = "sakti-project-tabs"`                        |
| `StoredState`                                 | (keep)                                                      |
| `openTabs`                                    | `projectTabs`                                               |
| `activeTabIndex`                              | `activeProjectIndex`                                        |
| `activeTab()`                                 | `activeProjectTab()`                                        |
| `openProjectTab(projectId, sessionId = null)` | `openProjectTab(projectId)` — drop sessionId param          |
| `newTab()`                                    | `newProjectTab()`                                           |
| `openSettingsTab()`                           | (unchanged)                                                 |
| `transformTab(index, projectId, sessionId)`   | `transformProjectTab(index, projectId)` — drop sessionId    |
| `closeTab(index)`                             | `closeProjectTab(index)`                                    |
| `switchTab(index)`                            | `switchProjectTab(index)`                                   |
| `setTabSession(projectId, sessionId)`         | (keep for now — removed in Phase 6)                         |
| `filterStaleProjects(validIds)`               | (unchanged)                                                 |

For `PageType`, change from `export type PageType = "home" | "settings"` to `export type PageType = "settings"`.

For `seedState`, change `tabs: [{ projectId: null, sessionId: null }]` to `tabs: [{ projectId: null }]`.

For `ProjectTab` interface, keep `sessionId` for now (Phase 6 removes it):

```ts
export interface ProjectTab {
  projectId: string | null;
  sessionId: string | null; // REMOVEME Phase 6
  page?: PageType;
}
```

Export at the bottom:

```ts
export { activeProjectIndex, projectTabs };
```

**Step 2: Update consumer imports**

Update these 6 files to import from `~/stores/workspace/project-tab-store` instead of `~/stores/workspace/tab-store`, and use the renamed functions:

1. `apps/desktop/src/components/layout/top-bar/top-bar.tsx`:
   - `import { openSettingsTab } from "~/stores/workspace/project-tab-store"`

2. `apps/desktop/src/components/layout/workspace-layout.tsx`:
   - `import { activeProjectTab, filterStaleProjects } from "~/stores/workspace/project-tab-store"`

3. `apps/desktop/src/components/layout/sidebar/sidebar.tsx`:
   - `import { activeProjectTab, openProjectTab } from "~/stores/workspace/project-tab-store"`
   - Note: `openProjectTab` now takes only `(projectId)` — remove second arg. The sidebar currently calls `openProjectTab(pid, sessionId)` — change to `openProjectTab(pid)`.

4. `apps/desktop/src/components/onboarding/onboarding-panel.tsx`:
   - `import { setTabSession } from "~/stores/workspace/project-tab-store"`

5. `apps/desktop/src/components/home/home.tsx`:
   - Update imports: `activeProjectTab`, `activeProjectIndex`, `openProjectTab`, `transformProjectTab`
   - `transformTab(activeTabIndex(), projectId)` → `transformProjectTab(activeProjectIndex(), projectId)`
   - `openProjectTab(projectId)` stays the same (no second arg needed)

6. `apps/desktop/src/components/layout/top-bar/project-tab.tsx`:
   - `import type { PageType } from "~/stores/workspace/project-tab-store"`
   - `import { activeProjectIndex, closeProjectTab, newProjectTab, projectTabs, switchProjectTab } from "~/stores/workspace/project-tab-store"`
   - Update all references in the component

**Step 3: Update onboarding test mock**

In `apps/desktop/src/components/onboarding/__tests__/onboarding-panel.test.tsx`:

```ts
vi.mock("~/stores/workspace/project-tab-store", () => ({
  setTabSession: vi.fn(),
}));
```

**Step 4: Run all desktop tests**

```bash
vp run desktop#test
```

Expected: PASS — all existing tests green.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(desktop): rename tab-store → project-tab-store

Mechanical rename: WorkspaceTab → ProjectTab, openTabs → projectTabs,
activeTabIndex → activeProjectIndex, etc. sessionId kept for now
(removed in Phase 6 when session-tab-store takes over)."
```

---

## Phase 3: Rename top-bar → header

### Task 3: Rename directory + files + update imports

**Files:**

- Rename: `apps/desktop/src/components/layout/top-bar/` → `header/`
- Rename: `top-bar.tsx` → `header.tsx`
- Rename: `top-bar.css` → `header.css`
- Rename: `project-tab.tsx` → `project-tabs.tsx`
- Modify: `workspace-layout.tsx` (import path)

**Step 1: Rename files**

```bash
cd apps/desktop/src/components/layout
git mv top-bar header
cd header
git mv top-bar.tsx header.tsx
git mv top-bar.css header.css
git mv project-tab.tsx project-tabs.tsx
```

**Step 2: Update header.tsx**

In `header.tsx`:

- Change `import "./top-bar.css"` to `import "./header.css"`
- Change `import ProjectTabBar from "./project-tab"` to `import ProjectTabs from "./project-tabs"`
- Change `export default function TopBar()` to `export default function Header()`
- Change `<ProjectTabBar />` to `<ProjectTabs />`

**Step 3: Update workspace-layout.tsx import**

```ts
import Header from "./header/header";
```

And `<TopBar />` → `<Header />`.

**Step 4: Run all desktop tests**

```bash
vp run desktop#test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(desktop): rename top-bar → header

Directory and file renames: top-bar.tsx → header.tsx, project-tab.tsx
→ project-tabs.tsx. Exports renamed: TopBar → Header, ProjectTabBar
→ ProjectTabs."
```

---

## Phase 4: Session tabs component

### Task 4: Create session-tabs component with Chrome-style CSS

**Files:**

- Create: `apps/desktop/src/components/layout/session-tabs/session-tabs.tsx`
- Create: `apps/desktop/src/components/layout/session-tabs/session-tabs.css`
- Create: `apps/desktop/src/components/layout/session-tabs/__tests__/session-tabs.test.tsx`

**Step 1: Create the CSS (restore Chrome-style from old tab-bar)**

Create `apps/desktop/src/components/layout/session-tabs/session-tabs.css`:

```css
.session-tab {
  --tab-curve: 10px;
  position: relative;
  border-top-left-radius: var(--tab-curve);
  border-top-right-radius: var(--tab-curve);
}

.session-tab-active-layer {
  position: absolute;
  inset: 0;
  background: var(--background);
  border-top-left-radius: var(--tab-curve);
  border-top-right-radius: var(--tab-curve);
}

.session-tab-active-layer::before,
.session-tab-active-layer::after {
  position: absolute;
  bottom: 0;
  width: var(--tab-curve);
  height: var(--tab-curve);
  pointer-events: none;
  content: "";
}

.session-tab-active-layer::before {
  left: calc(-1 * var(--tab-curve));
  border-bottom-right-radius: var(--tab-curve);
  box-shadow: 4px 4px 0 4px var(--background);
}

.session-tab-active-layer::after {
  right: calc(-1 * var(--tab-curve));
  border-bottom-left-radius: var(--tab-curve);
  box-shadow: -4px 4px 0 4px var(--background);
}

.session-tab-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse 80% 60% at 50% 0%,
    color-mix(in oklch, var(--primary) 14%, transparent) 0%,
    transparent 50%
  );
  border-top-left-radius: var(--tab-curve, 10px);
  border-top-right-radius: var(--tab-curve, 10px);
  animation: sessionTabGlowPulse 6s ease-in-out infinite;
}

@keyframes sessionTabGlowPulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-tab-glow {
    animation: none;
  }
}
```

**Step 2: Write the failing test**

Create `apps/desktop/src/components/layout/session-tabs/__tests__/session-tabs.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/stores/workspace/session-tab-store", () => ({
  ensureProjectTabs: vi.fn(),
  getSessionTabs: vi.fn(() => [
    { kind: "home", sessionId: null },
    { kind: "intake", sessionId: "s1" },
  ]),
  getActiveSessionIndex: vi.fn(() => 0),
  switchSessionTab: vi.fn(),
  closeSessionTab: vi.fn(),
}));

import { SessionTabs } from "../session-tabs";

describe("SessionTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a tab per session tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Intake")).toBeTruthy();
  });

  it("does not render close button on Home tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    const homeTab = screen.getByText("Home").closest("[role='tab']");
    expect(homeTab?.querySelector("button[aria-label*='Close']")).toBeNull();
  });

  it("renders close button on intake tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    expect(screen.getByLabelText("Close Intake tab")).toBeTruthy();
  });

  it("switches tab on click", () => {
    render(() => <SessionTabs projectId="p1" />);
    fireEvent.click(screen.getByText("Intake"));
    expect(vi.mocked(switchSessionTabMock)).toHaveBeenCalledWith("p1", 1);
  });

  it("closes tab on close button click", () => {
    render(() => <SessionTabs projectId="p1" />);
    fireEvent.click(screen.getByLabelText("Close Intake tab"));
    expect(vi.mocked(closeSessionTabMock)).toHaveBeenCalledWith("p1", 1);
  });
});

// Import the mocked functions for assertion
const { switchSessionTab: switchSessionTabMock, closeSessionTab: closeSessionTabMock } =
  await import("~/stores/workspace/session-tab-store");
```

**Step 3: Run test to verify it fails**

```bash
vp run desktop#test src/components/layout/session-tabs/__tests__/session-tabs.test.tsx
```

Expected: FAIL — module not found.

**Step 4: Implement the component**

Create `apps/desktop/src/components/layout/session-tabs/session-tabs.tsx`:

```tsx
import { motion } from "motion-solidjs";
import { FiMessageSquare, FiX, FiHome } from "solid-icons/fi";
import { For, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import {
  closeSessionTab,
  ensureProjectTabs,
  getActiveSessionIndex,
  getSessionTabs,
  switchSessionTab,
  type SessionTabKind,
} from "~/stores/workspace/session-tab-store";
import "./session-tabs.css";

interface SessionTabsProps {
  projectId: string;
}

function tabLabel(tab: { kind: SessionTabKind; sessionId: string | null }): string {
  switch (tab.kind) {
    case "home":
      return "Home";
    case "intake":
      return "Intake";
    case "mission":
      return "Mission";
  }
}

function tabIcon(tab: { kind: SessionTabKind }, className: string): JSX.Element {
  switch (tab.kind) {
    case "home":
      return <FiHome class={className} />;
    case "intake":
    case "mission":
      return <FiMessageSquare class={className} />;
  }
}

export function SessionTabs(props: SessionTabsProps): JSX.Element {
  ensureProjectTabs(props.projectId);
  const tabs = () => getSessionTabs(props.projectId);
  const activeIdx = () => getActiveSessionIndex(props.projectId);

  return (
    <div class="relative z-0 flex h-9 shrink-0 items-end bg-card pt-1.5">
      <div class="scrollbar-none flex min-w-0 flex-1 items-stretch">
        <For each={tabs()}>
          {(tab, index) => {
            const isActive = () => index() === activeIdx();
            return (
              <div
                aria-selected={isActive()}
                class={cn(
                  "session-tab group flex h-8 shrink-0 cursor-pointer items-center px-3 text-xs transition-colors",
                  isActive()
                    ? "z-10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
                onClick={() => switchSessionTab(props.projectId, index())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    switchSessionTab(props.projectId, index());
                  }
                }}
                role="tab"
                tabIndex={0}
              >
                <Show when={isActive()}>
                  <motion.div
                    class="session-tab-active-layer"
                    layoutId={`session-tab-active-${props.projectId}`}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  >
                    <div class="session-tab-glow" />
                  </motion.div>
                </Show>

                <div class="relative flex items-center gap-1.5">
                  {tabIcon(tab, "h-3 w-3 shrink-0 opacity-70")}
                  <span class="max-w-[140px] truncate">{tabLabel(tab)}</span>

                  <Show when={tab.kind !== "home"}>
                    <button
                      aria-label={`Close ${tabLabel(tab)} tab`}
                      class={cn(
                        "ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity",
                        isActive()
                          ? "opacity-60 hover:bg-secondary hover:opacity-100"
                          : "opacity-0 hover:bg-secondary group-hover:opacity-60",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeSessionTab(props.projectId, index());
                      }}
                      tabIndex={-1}
                      type="button"
                    >
                      <FiX class="h-3 w-3" />
                    </button>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <div class="pointer-events-none absolute right-0 bottom-0 left-0 h-px bg-border" />
    </div>
  );
}
```

**Step 5: Run tests to verify they pass**

```bash
vp run desktop#test src/components/layout/session-tabs/__tests__/session-tabs.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(desktop): add Chrome-style session tabs component

Inner tab strip with curved Chrome-style tabs. Home tab (index 0) is
not closeable. Intake/mission tabs have close buttons. Active tab
slides via motion-solidjs layoutId."
```

---

## Phase 5: Split OnboardingPanel

### Task 5: Create IntakeGrid (extract grid view)

**Files:**

- Create: `apps/desktop/src/components/onboarding/intake-grid.tsx`
- Create: `apps/desktop/src/components/onboarding/__tests__/intake-grid.test.tsx`

**Step 1: Write the failing test**

Create `apps/desktop/src/components/onboarding/__tests__/intake-grid.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  listChildIntakes: vi.fn(
    async () => [] as Array<{ id: string; title: string | null; updatedAt: number }>,
  ),
  createChildIntake: vi.fn(async () => ({ id: "new-1" })),
  openSessionTab: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      listChildIntakes: mocks.listChildIntakes,
      createChildIntake: mocks.createChildIntake,
    },
  }),
}));

vi.mock("~/stores/workspace/session-tab-store", () => ({
  openSessionTab: mocks.openSessionTab,
}));

import { IntakeGrid } from "../intake-grid";

const CHILD_A = { id: "child-a", title: "First intake", updatedAt: 1000, kind: "intake" as const };
const CHILD_B = { id: "child-b", title: "Second intake", updatedAt: 2000, kind: "intake" as const };

describe("IntakeGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a card per child intake", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([CHILD_A, CHILD_B]);
    render(() => <IntakeGrid projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First intake")).toBeTruthy());
    expect(screen.getByText("Second intake")).toBeTruthy();
  });

  it("renders New intake button", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([]);
    render(() => <IntakeGrid projectId="p1" />);

    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /New intake/i })).toBeTruthy(),
    );
  });

  it("opens intake as session tab when card is clicked", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([CHILD_A]);
    render(() => <IntakeGrid projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First intake")).toBeTruthy());
    fireEvent.click(screen.getByText("First intake"));

    expect(mocks.openSessionTab).toHaveBeenCalledWith("p1", "child-a", "intake");
  });

  it("creates child and opens as session tab when New intake is clicked", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([]);
    render(() => <IntakeGrid projectId="p1" />);

    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /New intake/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /New intake/i }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.createChildIntake).toHaveBeenCalledWith("p1");
    expect(mocks.openSessionTab).toHaveBeenCalledWith("p1", "new-1", "intake");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run desktop#test src/components/onboarding/__tests__/intake-grid.test.tsx
```

Expected: FAIL — module not found.

**Step 3: Implement IntakeGrid**

Create `apps/desktop/src/components/onboarding/intake-grid.tsx`:

```tsx
import { For, createResource, type JSX, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import { openSessionTab } from "~/stores/workspace/session-tab-store";
import { IntakeCard } from "./intake-card";

interface IntakeGridProps {
  projectId: string;
}

export const IntakeGrid = (props: IntakeGridProps): JSX.Element => {
  const { actions } = useStore();

  const [childrenResource, { refetch }] = createResource(
    () => props.projectId,
    async (projectId) => actions.listChildIntakes(projectId),
  );

  const handleNewIntake = async () => {
    const created = await actions.createChildIntake(props.projectId);
    if (created) {
      openSessionTab(props.projectId, created.id, "intake");
    }
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold text-lg tracking-tight">Intakes</h2>
          <p class="text-muted-foreground text-xs">
            Chat with an intake to scope a mission. Each intake shares the project's memory.
          </p>
        </div>
        <button
          class="shrink-0 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
          onClick={() => void handleNewIntake()}
          type="button"
        >
          New intake
        </button>
      </div>

      <Show
        when={(childrenResource() ?? []).length > 0}
        fallback={
          <div class="flex flex-1 items-center justify-center">
            <div class="text-center">
              <p class="text-muted-foreground text-sm">No intakes yet.</p>
              <p class="mt-1 text-muted-foreground text-xs">
                Click <strong>New intake</strong> to start scoping a mission.
              </p>
            </div>
          </div>
        }
      >
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <For each={childrenResource() ?? []}>
            {(child) => (
              <IntakeCard
                title={child.title}
                updatedAt={child.updatedAt}
                onClick={() => openSessionTab(props.projectId, child.id, "intake")}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
```

**Step 4: Run tests to verify they pass**

```bash
vp run desktop#test src/components/onboarding/__tests__/intake-grid.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(desktop): extract IntakeGrid from OnboardingPanel

Grid view showing intake cards. Clicking a card or pressing New intake
opens a session tab instead of an inline overlay."
```

### Task 6: Create IntakeChat (extract chat view)

**Files:**

- Create: `apps/desktop/src/components/onboarding/intake-chat.tsx`
- Create: `apps/desktop/src/components/onboarding/__tests__/intake-chat.test.tsx`

**Step 1: Write the failing test**

Create `apps/desktop/src/components/onboarding/__tests__/intake-chat.test.tsx`:

```tsx
import { render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  loadChat: vi.fn(),
  clearPendingAsk: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      loadChat: mocks.loadChat,
      confirmAsk: vi.fn(),
      createSession: vi.fn(),
      sendPrompt: vi.fn(),
    },
    sessions: {
      get: () => ({
        store: {
          streaming: { phase: "idle" },
          turns: [],
          pendingAsk: null,
        },
        actions: { clearPendingAsk: mocks.clearPendingAsk },
      }),
    },
    server: { store: { sessions: {} } },
  }),
}));

vi.mock("~/stores/workspace/session-tab-store", () => ({
  closeSessionTab: vi.fn(),
  openSessionTab: vi.fn(),
}));

vi.mock("~/stores/workspace/project-tab-store", () => ({
  setTabSession: vi.fn(),
}));

import { IntakeChat } from "../intake-chat";

describe("IntakeChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads chat on mount", () => {
    render(() => <IntakeChat projectId="p1" sessionId="s1" />);
    expect(mocks.loadChat).toHaveBeenCalledWith("s1");
  });

  it("does not render a Back button", () => {
    render(() => <IntakeChat projectId="p1" sessionId="s1" />);
    expect(screen.queryByText(/Back/i)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run desktop#test src/components/onboarding/__tests__/intake-chat.test.tsx
```

Expected: FAIL.

**Step 3: Implement IntakeChat**

Create `apps/desktop/src/components/onboarding/intake-chat.tsx`:

```tsx
import { createEffect, createMemo, type JSX, Show } from "solid-js";
import { AskCard } from "~/components/chat-area/parts/ask-card";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { useStore } from "~/stores/store-context";
import { closeSessionTab, openSessionTab } from "~/stores/workspace/session-tab-store";
import { EmptyState } from "./empty-state";

interface IntakeChatProps {
  projectId: string;
  sessionId: string;
}

export const IntakeChat = (props: IntakeChatProps): JSX.Element => {
  const { sessions, actions } = useStore();

  const sessionStore = createMemo(() => sessions.get(props.sessionId));

  let lastLoadedId: string | null = null;
  createEffect(() => {
    const id = props.sessionId;
    if (id && id !== lastLoadedId) {
      lastLoadedId = id;
      void actions.loadChat(id);
    }
  });

  const turns = createMemo(() => sessionStore()?.store.turns ?? []);
  const hasMessages = () => turns().length > 0;

  const handleConfirmSession = async () => {
    const session = sessionStore();
    const ask = session?.store.pendingAsk;
    if (!(session && ask)) return;

    await actions.confirmAsk(props.sessionId, ask.kind, ask.body, "approve");

    const title =
      ask.body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0)
        ?.slice(0, 80) ?? undefined;

    const missionSession = await actions.createSession(props.projectId, title);
    if (!missionSession) return;

    session.actions.clearPendingAsk();

    // Close the intake tab, open a mission tab.
    const intakeIdx = getSessionTabIndex(props.projectId, props.sessionId);
    if (intakeIdx >= 0) closeSessionTab(props.projectId, intakeIdx);
    openSessionTab(props.projectId, missionSession.id, "mission");

    actions.sendPrompt(missionSession.id, ask.body);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show
        fallback={<MessageTimeline sessionId={props.sessionId} turns={turns} />}
        when={!hasMessages()}
      >
        <EmptyState />
      </Show>
      <Show when={sessionStore()?.store.pendingAsk}>
        {(ask) => (
          <div class="px-4 pb-2">
            <AskCard
              kind={ask().kind}
              body={ask().body}
              onApprove={handleConfirmSession}
              onReject={() => sessionStore()?.actions.clearPendingAsk()}
            />
          </div>
        )}
      </Show>
      <ChatInput placeholder="Ask anything about this project…" sessionId={props.sessionId} />
    </div>
  );
};
```

Note: `getSessionTabIndex` needs to be exported from `session-tab-store`. Add it:

In `session-tab-store.ts`, add:

```ts
export function getSessionTabIndex(projectId: string, sessionId: string): number {
  const tabs = getSessionTabs(projectId);
  return tabs.findIndex((t) => t.sessionId === sessionId);
}
```

And import it in `intake-chat.tsx`:

```ts
import {
  closeSessionTab,
  getSessionTabIndex,
  openSessionTab,
} from "~/stores/workspace/session-tab-store";
```

**Step 4: Run tests to verify they pass**

```bash
vp run desktop#test src/components/onboarding/__tests__/intake-chat.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(desktop): extract IntakeChat from OnboardingPanel

Chat view for a single intake session. No Back button (tab-based nav).
Graduation closes the intake tab and opens a mission tab."
```

---

## Phase 6: Integration — wire everything together

### Task 7: Rewrite workspace-layout routing + remove sessionId from ProjectTab

This is the big integration task. All pieces from previous phases come together.

**Files:**

- Modify: `apps/desktop/src/stores/workspace/project-tab-store.ts` — remove `sessionId`
- Modify: `apps/desktop/src/components/layout/workspace-layout.tsx` — two-level routing
- Delete: `apps/desktop/src/components/onboarding/onboarding-panel.tsx` — replaced by IntakeGrid + IntakeChat
- Delete: `apps/desktop/src/components/onboarding/__tests__/onboarding-panel.test.tsx` — replaced by grid + chat tests
- Modify: `apps/desktop/src/components/layout/sidebar/sidebar.tsx` — wire to session-tab-store

**Step 1: Remove sessionId from project-tab-store**

In `project-tab-store.ts`:

- Remove `sessionId` from `ProjectTab` interface
- Remove `setTabSession` function entirely
- Remove `sessionId` from `seedState`, `loadFromStorage`, `saveToStorage`, `openProjectTab`, `transformProjectTab`
- Clean up all references to `sessionId` in the file

**Step 2: Rewrite workspace-layout.tsx**

Replace the current routing logic. The new layout:

```tsx
import { createEffect, type JSX, onMount, Show } from "solid-js";
import { MissionChatView } from "~/components/chat-area/mission-chat-view";
import Home from "~/components/home/home";
import { IntakeChat } from "~/components/onboarding/intake-chat";
import { IntakeGrid } from "~/components/onboarding/intake-grid";
import { SettingsPage } from "~/components/settings/settings-page";
import { useStore } from "~/stores/store-context";
import { activeProjectTab, filterStaleProjects } from "~/stores/workspace/project-tab-store";
import {
  ensureProjectTabs,
  filterStaleSessions,
  getActiveSessionTab,
  getSessionTabs,
} from "~/stores/workspace/session-tab-store";
import { sidebarOpen } from "~/stores/workspace/ui-signals";
import BannerConnection from "./banners/banner-connection";
import { BannerError, BannerHealth } from "./banners/banner-error";
import BannerUpdate from "./banners/banner-update";
import Header from "./header/header";
import SessionTabs from "./session-tabs/session-tabs";
import Sidebar from "./sidebar/sidebar";

export default function WorkspaceLayout(): JSX.Element {
  const { server, actions } = useStore();

  const activeProjectId = () => activeProjectTab()?.projectId ?? null;
  const isSettings = () => activeProjectTab()?.page === "settings";
  const isProject = () => activeProjectId() !== null;

  // Ensure inner tabs exist when project changes
  createEffect(() => {
    const pid = activeProjectId();
    if (pid) {
      ensureProjectTabs(pid);
      actions.listChildIntakes(pid).catch(() => {});
    }
  });

  // Sync active session to server store
  createEffect(() => {
    const pid = activeProjectId();
    if (!pid) {
      server.actions.setActiveSession(null);
      return;
    }
    const innerTab = getActiveSessionTab(pid);
    server.actions.setActiveProject(pid);
    server.actions.setActiveSession(innerTab?.sessionId ?? null);
  });

  // Filter stale projects on load
  createEffect(() => {
    const projectOrder = server.store.projectOrder;
    if (projectOrder.length > 0) {
      filterStaleProjects(new Set(projectOrder));
    }
  });

  // Filter stale session tabs
  createEffect(() => {
    const pid = activeProjectId();
    if (!pid) return;
    const validIds = new Set(
      server.store.sessionOrder
        .map((id) => server.store.sessions[id])
        .filter((s) => !!s && s.projectId === pid)
        .map((s) => s!.id),
    );
    filterStaleSessions(pid, validIds);
  });

  onMount(() => {
    actions.loadProjects().catch(() => {});
  });

  const activeSessionTabKind = () => {
    const pid = activeProjectId();
    if (!pid) return null;
    return getActiveSessionTab(pid)?.kind ?? null;
  };

  const activeSessionId = () => {
    const pid = activeProjectId();
    if (!pid) return null;
    return getActiveSessionTab(pid)?.sessionId ?? null;
  };

  return (
    <div class="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <div class="flex min-h-0 flex-1">
        <Show when={isProject() && !isSettings()}>
          <Sidebar />
        </Show>
        <main class="flex min-w-0 flex-1 flex-col">
          <Show when={isSettings()}>
            <SettingsPage />
          </Show>
          <Show when={!isProject() && !isSettings()}>
            <Home />
          </Show>
          <Show when={isProject() && !isSettings()}>
            <SessionTabs projectId={activeProjectId()!} />
            <BannerConnection />
            <BannerError />
            <BannerHealth />
            <BannerUpdate />
            <div class="relative min-h-0 flex-1">
              <div class="absolute inset-0 flex flex-col overflow-hidden">
                <Show when={activeSessionTabKind() === "home"}>
                  <IntakeGrid projectId={activeProjectId()!} />
                </Show>
                <Show when={activeSessionTabKind() === "intake"}>
                  <IntakeChat projectId={activeProjectId()!} sessionId={activeSessionId()!} />
                </Show>
                <Show when={activeSessionTabKind() === "mission"}>
                  <MissionChatView sessionId={activeSessionId()!} />
                </Show>
              </div>
            </div>
          </Show>
        </main>
      </div>
    </div>
  );
}
```

**Step 3: Update sidebar to use session-tab-store**

In `sidebar.tsx`:

- Remove `openProjectTab` import from project-tab-store (no longer needed for session switching)
- Import `openSessionTab`, `getActiveSessionTab` from session-tab-store
- Replace `activeTab()?.sessionId` with `getActiveSessionTab(activeProjectId())?.sessionId ?? null`
- Replace `selectSession`: `openProjectTab(pid, sessionId)` → `openSessionTab(pid, sessionId, "mission")`
- Replace `handleNewMission`: `openProjectTab(pid, intake.id)` → `openSessionTab(pid, intake.id, "intake")`

```tsx
// imports:
import { activeProjectTab } from "~/stores/workspace/project-tab-store";
import { getActiveSessionTab, openSessionTab } from "~/stores/workspace/session-tab-store";

// active session id:
const activeSessionId = () => {
  const pid = activeProjectId();
  if (!pid) return null;
  return getActiveSessionTab(pid)?.sessionId ?? null;
};

// select session:
const selectSession = (sessionId: string) => {
  const pid = activeProjectId();
  if (pid) openSessionTab(pid, sessionId, "mission");
};

// new mission:
const handleNewMission = async () => {
  const pid = activeProjectId();
  if (!pid) return;
  const intake = await actions.createChildIntake(pid);
  if (intake) openSessionTab(pid, intake.id, "intake");
};
```

**Step 4: Update home.tsx**

In `home.tsx`:

- `transformTab` → `transformProjectTab` (already done in Task 2)
- `activeTabIndex` → `activeProjectIndex` (already done in Task 2)
- Remove any `sessionId` params from `openProjectTab` / `transformProjectTab` calls
- `openProjectTab(projectId)` — no second arg
- `transformProjectTab(activeProjectIndex(), projectId)` — no sessionId

**Step 5: Delete old OnboardingPanel**

```bash
rm apps/desktop/src/components/onboarding/onboarding-panel.tsx
rm apps/desktop/src/components/onboarding/__tests__/onboarding-panel.test.tsx
```

**Step 6: Run all desktop tests**

```bash
vp run desktop#test
```

Expected: PASS — fix any remaining import errors.

**Step 7: Run vp check**

```bash
vp check --fix
```

Expected: no errors.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat(desktop): wire two-level tab navigation

Remove sessionId from ProjectTab — session-tab-store is now the source
of truth for active sessions. workspace-layout routes based on inner
tab kind (home/intake/mission). Sidebar uses openSessionTab. Old
OnboardingPanel deleted — replaced by IntakeGrid + IntakeChat.

BREAKING: tab state reset (new localStorage keys)."
```

---

## Post-implementation verification

After all tasks are complete:

1. **Run full test suite:** `vp run -r test`
2. **Run type check + lint:** `vp check`
3. **Manual test flow:**
   - App opens → Home (project picker)
   - Open a project → Home tab (intake grid) + SessionTabs strip visible
   - Click "New intake" → new Intake tab opens
   - Chat with intake → works
   - Approve ask → intake tab closes, mission tab opens
   - Click sidebar mission → opens as mission tab
   - Close a tab → tab disappears, session preserved in sidebar
   - Switch projects → project tab switches, inner tabs swap
