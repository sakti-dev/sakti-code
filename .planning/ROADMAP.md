# Roadmap: Settings Dialog Migration

## Overview

Convert the existing settings page into a dialog/modal component with two-column layout, matching the dark-themed aesthetic of model-selector and provider-settings modal. Project consists of 3 phases delivering a complete settings dialog with General tab and navigation.

---

## Phase 1: Foundation & UI Components

**Goal:** Build atomic UI components and establish dialog structure with two-column layout

**Dependencies:** None (first phase)

**Requirements:**

- UI-01: Select dropdown component with dark theme styling
- UI-02: Toggle switch component with dark theme styling
- UI-03: Settings row component (label + description + control)
- UI-04: Settings section header component
- DIALOG-01: Settings dialog component with two-column layout (sidebar + content)
- DIALOG-02: Sidebar navigation with all menu items

**Success Criteria:**

1. **Select dropdown renders correctly** — User sees a dark-themed dropdown with options visible on click, matching model-selector aesthetic
2. **Toggle switch toggles state** — User can click toggle and see it change between on/off states with visual feedback
3. **Settings row displays label and control** — User sees label on left, description below, and control on right in a single row
4. **Settings section header separates groups** — User sees section titles that visually group related settings
5. **Dialog opens as modal** — User sees dialog centered on screen with overlay behind it, dialog traps focus
6. **Two-column layout renders** — User sees left sidebar with menu items and right content area

---

## Phase 2: Navigation & General Tab

**Goal:** Implement sidebar navigation behavior and General tab content

**Dependencies:** Phase 1 (requires dialog structure and UI components)

**Requirements:**

- DIALOG-03: Active state styling for selected sidebar item
- DIALOG-04: External link icon for Changelog and Docs items
- GENERAL-01: Default model selector (dropdown)
- GENERAL-02: Default thinking level selector (dropdown)
- GENERAL-03: Theme selector (dropdown: System/Light/Dark)
- GENERAL-04: Session notifications toggle
- GENERAL-05: Completion sound effects toggle
- GENERAL-06: Send messages with selector (Enter / Shift+Enter)
- GENERAL-07: "I'm not absolutely right" toggle
- GENERAL-08: Strict data privacy toggle

**Success Criteria:**

1. **Sidebar shows active state** — User clicks a menu item and sees it highlighted as the active tab
2. **Tabs switch content** — User clicks different sidebar items and sees corresponding settings content
3. **External links show icon** — User sees external link icon next to Changelog and Docs items
4. **General settings render** — User sees all 8 General settings with correct labels, descriptions, and controls
5. **Dropdown selections persist in UI** — User can select options from dropdowns and see their selection reflected

---

## Phase 3: Integration

**Goal:** Replace existing settings-view with dialog and wire up triggers

**Dependencies:** Phase 2 (requires complete dialog with General tab)

**Requirements:**

- INT-01: Replace settings-view.tsx with dialog trigger in navigation
- INT-02: Dialog opens on settings menu click
- INT-03: Theme toggle updates application theme

**Success Criteria:**

1. **Settings menu triggers dialog** — User clicks Settings in navigation and dialog opens
2. **Settings view is replaced** — Old settings-view.tsx is no longer used as separate page
3. **Theme changes apply immediately** — User selects different theme and sees app theme update in real-time
4. **Dialog closes properly** — User can close dialog via close button, overlay click, or Escape key

---

## Progress

| Phase | Name                       | Requirements | Status  |
| ----- | -------------------------- | ------------ | ------- |
| 1     | Foundation & UI Components | 6/6          | Pending |
| 2     | Navigation & General Tab   | 10/10        | Pending |
| 3     | Integration                | 3/3          | Pending |

---

## Notes

- **Out of Scope:** Account, Git, Terminal, MCP, Commands, Agents, Memory, Hooks, Providers, Experimental tabs (v0.2)
- **Out of Scope:** Settings persistence, sync, search, reset-to-defaults (future versions)
- **Depth:** 3 phases derived from requirements; Phase 4 (Polish) deferred to future milestone

---

_Last updated: 2026-02-22_
