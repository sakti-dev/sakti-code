# Header + Inner Tab Strip Design

Date: 2026-07-04

## Problem

The current single-level tab system conflates project navigation with session navigation. The `OnboardingPanel` overlays intake chat within the grid view using a `selectedChildId` signal — no dedicated tab per intake. The `top-bar/` directory name doesn't reflect its role. The tab store mixes `projectId` and `sessionId` in one flat `WorkspaceTab` structure.

## Solution

Two-level tab navigation: **project tabs** (top, in the header) and **session tabs** (inner, in a tab strip within the main content area). Each level has its own store.

## Layout

```
+----------------------------------------------+
| Header (project tabs + settings button)      |
+--------+-------------------------------------+
|        | Tab strip (Home | Intake1 | Miss1)  |
| Sidebar+-------------------------------------+
|        | Chat area                           |
|        | (intake grid / chat / mission)      |
+--------+-------------------------------------+
```

When no project is open (new workspace tab or settings tab): full-width content, no sidebar, no tab strip.

## Directory Structure

```
components/layout/
  header/                         renamed from top-bar/
    header.tsx                    was top-bar.tsx (exports Header)
    header.css                    was top-bar.css
    project-tabs.tsx              was project-tab.tsx (exports ProjectTabs)
  sidebar/                        unchanged
  session-tabs/                   NEW
    session-tabs.tsx              renders Home + intake/mission tabs
    session-tabs.css              Chrome-style curved tabs (restored from old tab-bar/)
```

Store renames:

- `tab-store.ts` → `project-tab-store.ts`
- New: `session-tab-store.ts`

## Store Model

### project-tab-store.ts (renamed)

```ts
interface ProjectTab {
  projectId: string | null;
  page?: "settings";
}
```

Changes from current `WorkspaceTab`:

- `sessionId` field REMOVED — moves to inner tabs
- `PageType` simplified: `"home"` removed (it's now an inner tab kind). Only `"settings"` remains.
- New localStorage key: `sakti-project-tabs` (old `sakti-workspace-tabs` abandoned — breaking change).

Function renames:
| Old | New |
|-----|-----|
| `openTabs` | `projectTabs` |
| `activeTabIndex` | `activeProjectIndex` |
| `activeTab()` | `activeProjectTab()` |
| `openProjectTab(projectId, sessionId?)` | `openProjectTab(projectId)` |
| `newTab()` | `newProjectTab()` |
| `closeTab(index)` | `closeProjectTab(index)` |
| `switchTab(index)` | `switchProjectTab(index)` |
| `transformTab(index, projectId, sessionId?)` | `transformProjectTab(index, projectId)` |

Deleted: `setTabSession` (moves to session-tab-store as `openSessionTab`).
Unchanged: `openSettingsTab()`, `filterStaleProjects()`.

### session-tab-store.ts (new)

```ts
type SessionTabKind = "home" | "intake" | "mission";

interface SessionTab {
  kind: SessionTabKind;
  sessionId: string | null; // null for "home"
}
```

Per-project state persisted to localStorage key `sakti-session-tabs`:

```json
{
  "proj-1": {
    "tabs": [
      { "kind": "home", "sessionId": null },
      { "kind": "intake", "sessionId": "sess-a" },
      { "kind": "mission", "sessionId": "sess-b" }
    ],
    "activeIndex": 2
  }
}
```

Each project always has Home at index 0 (not closeable). Inner tabs are a **working set** — opening a session from the sidebar adds it; closing drops it (session persists in DB).

Functions:

- `getSessionTabs(projectId)` → `SessionTab[]`
- `getActiveSessionIndex(projectId)` → `number`
- `getActiveSessionTab(projectId)` → `SessionTab | null`
- `openSessionTab(projectId, sessionId, kind)` — add or activate existing
- `closeSessionTab(projectId, index)` — reject if index 0 (Home)
- `switchSessionTab(projectId, index)`
- `filterStaleSessions(projectId, validSessionIds: Set<string>)` — drop tabs whose sessionId no longer exists
- `ensureProjectTabs(projectId)` — ensure Home tab exists (called when project opens)

## View Routing (workspace-layout.tsx)

```
activeProjectTab().page === "settings" → SettingsPage (full width)
activeProjectTab().projectId === null  → Home / project picker (full width)
else → project workspace:
  Sidebar | [SessionTabs strip + content based on active inner tab]
```

Inner tab content:

- `kind: "home"` → IntakeGrid (grid of intake cards + "New intake" button)
- `kind: "intake"` → IntakeChat (timeline + input + ask card, no Back button)
- `kind: "mission"` → MissionChatView (unchanged)

## OnboardingPanel Split

Current `OnboardingPanel` does two things (grid + inline chat overlay). Split into:

- **`IntakeGrid`** — grid view only. Props: `{ projectId }`. Fetches child intakes. Clicking a card → `openSessionTab(projectId, childId, "intake")`. "New intake" → create + open tab.
- **`IntakeChat`** — chat for a specific intake session. Props: `{ projectId, sessionId }`. Renders timeline + input + ask card. No Back button, no grid.

## Graduation Flow

When an intake is approved/graduated:

1. Confirm the ask on the server (graduation runs — child transcript → project OM)
2. Create mission session
3. **Close** the intake inner tab
4. **Open** a mission inner tab with the new session
5. Send the prompt to the mission

This replaces the current flow where `setTabSession(projectId, missionSession.id)` replaces the project tab's session.

## Sidebar Changes

- "New mission" button → `createChildIntake(projectId)` + `openSessionTab(projectId, intakeId, "intake")`
- Clicking a mission row → `openSessionTab(projectId, missionId, "mission")`
- Mission list (active + archived) unchanged — complements the tab strip (sidebar = full list, tab strip = working set)

## Visual Design

- **Project tabs** (header): keep current flat pill style
- **Session tabs** (inner strip): restore the Chrome-style curved tab look from the old `tab-bar/project-tab-bar.css` — curved top corners, shoulder pseudo-elements with box-shadow, active layer with motion-solidjs `layoutId` slide, aurora glow, bottom border line that the active tab breaks
