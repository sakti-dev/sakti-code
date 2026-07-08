# desktop-renderer-ui Specification

## Purpose

The desktop-renderer-ui capability provides the layout shell and top-level views that compose the workspace around the chat interface. It includes the `WorkspaceLayout` (root composition of header, sidebar, session tabs, banners, and content area), the `Header` with project tabs and settings toggle, the `Sidebar` with mission list and archived-accordion, the `Home` view (project picker, folder open, clone repo), the `PlanGrid` (onboarding view with suggestion cards and plan list), the `SettingsPage` configuration, and status banners (connection, error, health, update).

## Requirements

### Requirement: Workspace layout

The `WorkspaceLayout` SHALL compose the full-screen application shell: `Header` at top, then a horizontal split of `Sidebar` (left, shown only for active projects) and a `<main>` area (right). The main area SHALL switch between `SettingsPage` (when the active tab is settings), `Home` (when no project is active), and a project view (when a project is active). The project view SHALL render `SessionTabs` (the per-project tab strip), status banners, and the content for the active session tab: `PlanGrid` for `"home"` kind, `PlanChat` for `"plan"` kind, `MissionChatView` for `"mission"` kind.

#### Scenario: layout shows sidebar only for projects

- **WHEN** no project tab is active
- **THEN** `SettingsPage` or `Home` is shown, no sidebar
- **WHEN** a project tab is active (not settings)
- **THEN** `Sidebar` is shown to the left of the main content

#### Scenario: active session tab determines content

- **WHEN** the active session tab has `kind: "home"`
- **THEN** `PlanGrid` renders
- **WHEN** the active session tab has `kind: "plan"`
- **THEN** `PlanChat` renders with the session ID
- **WHEN** the active session tab has `kind: "mission"`
- **THEN** `MissionChatView` renders with the session ID

#### Scenario: layout initializes project data on mount

- **WHEN** the layout mounts
- **THEN** `actions.loadProjects()` is called once
- **AND** when a project is selected, `actions.listChildPlans(projectId)` is called

#### Scenario: active tab syncs server store

- **WHEN** the active project ID changes
- **THEN** the server store's `activeProjectId` and `activeSessionId` are updated

#### Scenario: stale tabs are filtered

- **WHEN** projects or sessions are loaded
- **THEN** stale project tabs and session tabs (whose IDs no longer exist server-side) are filtered out

### Requirement: Header

The `Header` SHALL display `ProjectTabs` (clickable project names) and a settings gear button. The settings button SHALL call `openSettingsTab()`.

#### Scenario: settings button opens settings tab

- **WHEN** the user clicks the gear icon in the header
- **THEN** a new settings tab is opened via `openSettingsTab()`

### Requirement: Sidebar

The `Sidebar` SHALL display a list of active missions for the current project, sorted by `updatedAt` descending. Each `MissionRow` SHALL show the mission title, status badge, streaming phase indicator, and `updatedAt` timestamp. The sidebar SHALL support:
- Click to select a mission (opens its session tab)
- Inline rename (triggers `actions.renameSession`)
- Delete with confirmation dialog (triggers `actions.deleteSession`)
- A "New mission" button that calls `openDraftPlanTab`
- An `ArchivedAccordion` listing archived (`status: "done"`) missions in a collapsible section
- Toggle visibility via `Ctrl+B` keyboard shortcut
- Mobile overlay (fixed positioned scrim + sidebar) when toggled on narrow viewports

#### Scenario: active missions are listed

- **WHEN** there are active (non-done) missions for the active project
- **THEN** they appear in the sidebar sorted by `updatedAt` descending
- **WHEN** there are no missions
- **THEN** a "No missions yet" placeholder is shown

#### Scenario: archived missions are collapsible

- **WHEN** there are archived missions
- **THEN** they appear in an `ArchivedAccordion` expandable section below active missions

#### Scenario: new mission button opens draft plan tab

- **WHEN** the "New mission" button is clicked
- **THEN** `openDraftPlanTab(projectId)` is called
- **AND** a new plan tab opens in the main area

#### Scenario: delete requires confirmation

- **WHEN** the user clicks delete on a mission row
- **THEN** a `window.confirm` dialog is shown with the mission title
- **AND** the session is deleted only after confirmation

#### Scenario: Ctrl+B toggles sidebar

- **WHEN** the user presses `Ctrl+B` or `Cmd+B`
- **THEN** `sidebarOpen` is toggled

### Requirement: Session tabs

The `SessionTabs` component SHALL render a horizontal tab strip for the current project containing all session tabs (home, plan, mission). Tabs display a label derived from `kind` and optional `title`. The home tab SHALL be first, pinned, and non-closable. Other tabs SHALL be closable. Clicking a tab SHALL call `switchSessionTab`. The tab strip SHALL be scrollable horizontally and styled for overflow.

#### Scenario: tabs render with labels

- **WHEN** session tabs are loaded for a project
- **THEN** each tab shows a derived label
- **AND** the home tab is first and cannot be closed

#### Scenario: clicking a tab switches view

- **WHEN** a tab is clicked
- **THEN** `switchSessionTab(projectId, index)` is called
- **AND** the content below switches to the selected tab

### Requirement: Status banners

The system SHALL render the following banners above the content area:

- **BannerConnection**: shown when `connection.status` is `"connecting"` or `"closed"` — indicates WebSocket state
- **BannerError**: shown when `lastError` signal is non-null — displays the error message with a dismiss action
- **BannerHealth**: shown when `healthIssues` has entries — displays each issue with type
- **BannerUpdate**: shown when `updateAvailable` is `true` — displays the new version

#### Scenario: connection banner shows during reconnect

- **WHEN** WebSocket status is `"connecting"` or `"closed"`
- **THEN** a banner is shown indicating the connection state

#### Scenario: error banner dismisses

- **WHEN** an error is set via `setLastError`
- **THEN** a dismissable error banner appears
- **WHEN** the user dismisses it
- **THEN** `setLastError(null)` clears the error

### Requirement: Home view

The `Home` view SHALL be the landing page when no project is selected. It SHALL display:
- A branded hero section with app name/tagline
- Two action cards: "Open Folder" (calls `GET /api/dialog/folder` via fetch, then `actions.addProject`), "Clone Repository" (opens a clone dialog, then `actions.addProject` with the URL)
- A searchable project list with `SearchBar`, filtering by project name
- Project cards showing project name, path, and recent sessions
- A `CloneDialog` modal for entering a Git URL
- A `KeyboardShortcutsFooter` showing essential shortcuts

#### Scenario: open folder triggers native dialog

- **WHEN** the user clicks "Open Folder"
- **THEN** `fetch("/api/dialog/folder")` invokes the native Electron folder picker
- **AND** if a folder path is returned, `actions.addProject` adds it
- **AND** the new project tab is opened

#### Scenario: clone repo creates a project

- **WHEN** the user submits a URL in the clone dialog
- **THEN** `actions.addProject(url)` is called
- **AND** the new project tab is opened

#### Scenario: projects are searchable by name

- **WHEN** the user types in the search bar
- **THEN** the project list is filtered case-insensitively by name

### Requirement: PlanGrid (onboarding view)

The `PlanGrid` SHALL be the home tab content for a project. It SHALL show:
- A heading "What are we building?"
- A "Start a new plan" button that opens a draft plan tab
- A list of suggestion prompts (add feature, fix bug, plan refactor)
- A "Recent" grid of `PlanCard` components for existing child plan sessions (fetched via `actions.listChildPlans`)

Each `PlanCard` SHALL display the plan title, last-updated timestamp, and a pending-transition indicator badge. Clicking a plan card SHALL open its session tab with kind `"plan"`.

#### Scenario: new plan button opens draft tab

- **WHEN** the user clicks "Start a new plan"
- **THEN** `openDraftPlanTab(projectId)` is called
- **AND** a new `"plan"` tab with `sessionId: null` opens

#### Scenario: recent plans are fetched on mount

- **WHEN** `PlanGrid` mounts
- **THEN** `actions.listChildPlans(projectId)` is called
- **AND** results appear in the "Recent" grid
- **WHEN** no plans exist
- **THEN** suggestion prompts are shown instead

#### Scenario: plan card opens session tab

- **WHEN** a plan card is clicked
- **THEN** `openSessionTab(projectId, sessionId, "plan")` is called

### Requirement: Settings page

The `SettingsPage` SHALL render configuration panels in a sidebar+content layout. The sidebar SHALL list setting categories (tabs). The content area SHALL display the selected tab's content. Settings tabs SHALL include server configuration and model profile management.

#### Scenario: settings render in sidebar+content layout

- **WHEN** the settings page is opened
- **THEN** a sidebar lists setting categories
- **AND** the selected category's content is shown in the main area
