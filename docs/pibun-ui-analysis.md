# Pibun Reference UI — Complete Analysis

> Reference: `openspec/references/pibun/apps/web/`
> Purpose: Blueprint for cloning the Sakti UI (React → SolidJS, Zustand → Signals)

## 1. Directory Structure

```
apps/web/src/
├── index.html                    # Entry HTML
├── index.css                    # Global styles + Tailwind theme tokens (101 lines)
├── main.tsx                      # React app entry
├── vite.config.ts                # Vite config
├── transport.ts                  # WebSocket transport abstraction
├── wireTransport.ts               # Wire transport (native API bridge)
├── components/
│   ├── AppShell.tsx              # Top-level layout: sidebar + main area
│   ├── Sidebar.tsx               # Project tree + session list (~1556 lines)
│   ├── ChatView.tsx              # Virtualized scrollable message area (707 lines)
│   ├── Composer.tsx              # Message input (1653 lines)
│   ├── ContentTabBar.tsx         # Chat + Terminal tab bar (545 lines)
│   ├── ModelSelector.tsx         # LLM model dropdown (338 lines)
│   ├── ThinkingSelector.tsx      # Thinking level selector
│   ├── ThemeSelector.tsx         # Theme picker
│   ├── Markdown.tsx              # Markdown renderer (GFM + Shiki code blocks)
│   ├── CodeBlock.tsx             # Syntax-highlighted code block (Shiki)
│   ├── CompactButton.tsx         # Manual context compaction trigger
│   ├── ComposerCommandMenu.tsx   # Slash commands + file mentions + model picker
│   ├── ConnectionBanner.tsx       # WebSocket connection status banner
│   ├── ErrorBanner.tsx           # Error + health issue banners
│   ├── UpdateBanner.tsx           # Auto-update notification
│   ├── SetupScreen.tsx            # Pi CLI installation onboarding
│   ├── SettingsDialog.tsx        # Settings modal
│   ├── ExportDialog.tsx          # Session export to HTML
│   ├── ForkDialog.tsx            # Session fork dialog
│   ├── SessionBrowserDialog.tsx # Past session browser
│   ├── SessionStats.tsx          # Token + cost statistics
│   ├── StatusBar.tsx              # Extension status indicators
│   ├── GitStatusBar.tsx          # Branch + changed files in toolbar
│   ├── GitPanel.tsx              # Collapsible git changed-files panel
│   ├── DiffPanel.tsx             # Side panel with per-turn diffs
│   ├── DiffViewer.tsx            # Syntax-highlighted diff rendering
│   ├── TerminalInstance.tsx      # Full-height embedded xterm.js terminal
│   ├── PluginManager.tsx         # Plugin install/enable/disable
│   ├── PluginPanel.tsx           # Plugin panels (sidebar, bottom, right)
│   ├── ExtensionDialog.tsx        # Extension UI dialog (modal)
│   ├── ExtensionWidgets.tsx      # Extension widgets above/below composer
│   ├── ToastContainer.tsx        # Toast notifications
│   ├── ImagePreviewModal.tsx     # Full-size image preview overlay
│   └── chat/
│       ├── ChatMessages.tsx      # UserMessage, AssistantMessage, SystemMessage, TurnDivider
│       ├── ToolCards.tsx         # ToolCallMessage, ToolResultMessage, ToolExecutionCard
│       ├── WorkGroup.tsx         # Collapsible group of tool executions per turn
│       └── ToolOutput.tsx        # BashOutput, ReadOutput, EditOutput, WriteOutput, DefaultOutput
├── hooks/
│   ├── useChatScroll.ts         # Pointer-aware auto-scroll detection
│   ├── useKeyboardShortcuts.ts   # Global keyboard shortcut dispatch
│   └── useWindowTitle.ts         # Dynamic window title
├── lib/
│   ├── themes.ts                 # 5 built-in themes + applyTheme + localStorage persistence
│   ├── highlighter.ts           # Shiki singleton with lazy theme/language loading
│   ├── utils.ts                  # cn(), formatDuration, formatTimestamp, keybindings helpers
│   ├── keybindings.ts           # Configurable keybinding system
│   ├── appActions.ts            # App-level actions (projects, terminals, draft persistence)
│   ├── sessionActions.ts        # Session actions (start, prompt, compact, fork, export)
│   ├── tabActions.ts             # Tab management actions
│   └── pluginMessageBridge.ts    # Plugin iframe message bridge
└── store/
    ├── index.ts                  # Combined Zustand store (create from slices)
    └── types.ts                  # All slice interfaces + ChatMessage type + TerminalTab (749 lines)
```

---

## 2. Layout Structure

```
+-------------------------------------------------------------------+
| flex h-screen bg-surface-base text-text-primary                      |
|                                                                     |
| +-----------+  +--------------------------------------------------+ |
| |           |  | <main> flex-1 flex-col                            | |
| | Sidebar   |  |   ConnectionBanner                                  | |
| |           |  |   HealthBanner                                     | |
| | (left     |  |   ErrorBanner                                      | |
| |  panel)   |  |   UpdateBanner                                     | |
| |           |  |                                                    | |
| | Header:   |  |   TOOLBAR (border-b border-border-secondary)        | |
| | "PiBun"   |  |   [≡] | ModelSel ThinkSel | spacer | GitStat |    | |
| |           |  |   Stats | [Compact][Fork][Export][Plugins]          | |
| | PROJECTS  |  |         [Theme][Settings]                           | |
| | [+][↻]    |  |                                                    | |
| | ▶ proj-a  |  |   ContentTabBar                                     | |
| |   session1|  |   [💬 Pi] [Terminal 1] [Terminal 2] [+]           | |
| |   session2|  |                                                    | |
| | ▸ proj-b  |  |   CONTENT AREA (relative flex-1)                    | |
| | ▸ proj-c  |  |   ├── Chat layer (absolute inset-0):               | |
| |           |  |   │   GitPanel (collapsible)                       | |
| | ──footer──|  |   │   ChatView (virtualized scroll)               | |
| | update st.|  |   │   PluginBottomPanels                            | |
| +-----------+  |   │   StatusBar                                    | |
|                 |   │   ExtensionWidgetBar (above)                   | |
|                 |   │   Composer                                     | |
|                 |   │   ExtensionWidgetBar (below)                   | |
|                 |   │                                                 | |
|                 |   ├── Terminal layers (absolute, hidden):           | |
|                 |   │   TerminalInstance x N                         | |
|                 |   +-------------------------------------------------+ |
|                 |                                                     | |
|                 |   DiffPanel (right, togglable Ctrl+D)              | |
|                 +----------------------------------------------------+ |
+-------------------------------------------------------------------+

Modal overlays: ExtensionDialog, ImagePreviewModal, SettingsDialog, ToastContainer
```

### Responsive behavior
- **Desktop (>=768px):** Sidebar inline, toggleable via Ctrl/Cmd+B
- **Mobile (<768px):** Sidebar is overlay panel with backdrop, auto-closes on action

### Content switching
Chat and terminals use **absolute positioning** within a `relative` container. Only the active tab is visible; inactive ones use `hidden` (display:none) to preserve xterm.js instances.

---

## 3. Theme System

### CSS approach
- **Tailwind CSS v4** via `@import "tailwindcss"` + `@tailwindcss/vite` plugin
- Single CSS file: `index.css` (101 lines)
- All styling is **inline Tailwind utility classes** — no separate CSS component files
- Custom scrollbar styling via `::-webkit-scrollbar`

### Color tokens
Semantic tokens via Tailwind v4 `@theme` directive → CSS custom properties (`--color-{token}`).

| Category | Tokens |
|----------|--------|
| **Surface (backgrounds)** | `surface-base`, `surface-primary`, `surface-secondary`, `surface-tertiary`, `surface-overlay` |
| **Text** | `text-primary`, `text-secondary`, `text-tertiary`, `text-muted`, `text-on-accent` |
| **Border** | `border-primary`, `border-secondary`, `border-muted` |
| **Accent (blue)** | `accent-primary`, `accent-primary-hover`, `accent-soft`, `accent-text` |
| **Status Error** | `status-error`, `status-error-bg`, `status-error-text`, `status-error-border` |
| **Status Success** | `status-success`, `status-success-bg`, `status-success-text`, `status-success-border` |
| **Status Warning** | `status-warning`, `status-warning-bg`, `status-warning-text` |
| **Status Info** | `status-info`, `status-info-bg`, `status-info-text` |
| **Thinking** | `thinking-bg`, `thinking-border`, `thinking-text` |
| **Code** | `code-bg`, `code-inline-bg` |
| **User bubble** | `user-bubble-bg`, `user-bubble-text` |
| **Scrollbar** | `scrollbar-thumb`, `scrollbar-track` |

### Default (dark) token values
```
surface-base:       #0a0a0a   (neutral-950)
surface-primary:   #171717   (neutral-900)
surface-secondary: #262626   (neutral-800)
surface-tertiary:  #404040   (neutral-700)
surface-overlay:   rgba(23,23,23,0.5)

text-primary:       #f5f5f5   (neutral-100)
text-secondary:     #d4d4d4   (neutral-300)
text-tertiary:      #a3a3a3   (neutral-500)
text-muted:         #525252   (neutral-600)
text-on-accent:     #ffffff

border-primary:     #404040   (neutral-700)
border-secondary:   #262626   (neutral-800)

accent-primary:         #3b82f6   (blue-500)
accent-primary-hover:   #2563eb   (blue-600)
accent-soft:            rgba(96,165,250,0.1)
accent-text:            #60a5fa   (blue-400)

status-error:           #ef4444   (red-500)
status-success:         #22c55e   (green-500)
status-warning:         #f59e0b   (amber-500)

thinking-bg:            rgba(99,102,241,0.1)
thinking-border:        rgba(99,102,241,0.3)
thinking-text:          #a5b4fc   (indigo-300)

code-bg:                #0a0a0a
code-inline-bg:         #262626

user-bubble-bg:         #3b82f6   (blue-500)
user-bubble-text:       #ffffff

scrollbar-thumb:        #404040
scrollbar-track:       transparent
```

### 5 Built-in themes

| ID | Name | isDark | Shiki Theme | Default? |
|----|------|--------|-------------|----------|
| `dark` | Dark | true | `github-dark-default` | |
| `light` | Light | false | `github-light-default` | |
| `dimmed` | Dimmed | true | `github-dark-dimmed` | **Yes** |
| `high-contrast-dark` | High Contrast Dark | true | `github-dark-high-contrast` | |
| `high-contrast-light` | High Contrast Light | false | `github-light-high-contrast` | |

### Runtime theme switching
`applyTheme()` sets CSS custom properties as inline styles on `<html>`, sets `data-theme` attribute, updates Shiki code highlighting theme (async), and broadcasts to plugin iframes. Preference persisted to `localStorage` under key `"pibun-theme"`.

---

## 4. Component Catalog

### 4.1 AppShell (`AppShell.tsx`, 304 lines)

Top-level layout component. Composes all other components.

**Structure:**
```
<div class="flex h-screen bg-surface-base text-text-primary">
  <ExtensionDialog />          {/* Modal overlay */}
  <ImagePreviewModal />        {/* Modal overlay */}
  <SettingsDialog />           {/* Modal overlay */}
  <ToastContainer />           {/* Fixed bottom-right */}
  <Sidebar />
  <div class="flex min-w-0 flex-1">       {/* Main area wrapper */}
    <main class="flex min-w-0 flex-1 flex-col">
      <ConnectionBanner />
      <HealthBanner />
      <ErrorBanner />
      <UpdateBanner />
      <Toolbar />                      {/* Model/Thinking selectors + controls */}
      <ContentTabBar />
      <div class="relative flex-1 min-h-0">  {/* Content area */}
        <Chat layer />                  {/* absolute inset-0, flex-col */}
        <Terminal layers />             {/* absolute inset-0, hidden */}
      </div>
    </main>
    <DiffPanel />                       {/* Right side */}
    <PluginRightPanels />               {/* Right side */}
  </div>
</div>
```

**Toolbar contents (left to right):**
1. Sidebar toggle button (hamburger / panel icon)
2. Divider (`h-5 w-px bg-border-secondary`)
3. ModelSelector
4. ThinkingSelector
5. Spacer (`flex-1`)
6. GitStatusBar
7. Divider
8. SessionStats
9. Session controls in bordered group: CompactButton, ForkDialog, ExportDialog, PluginManager, ThemeSelector, SettingsButton

**Gate:** Shows `<SetupScreen />` if Pi CLI is missing/outdated.

### 4.2 Sidebar (`Sidebar.tsx`, ~1556 lines)

Left panel with project tree and session list.

**Visual structure:**
```
┌─────────────────────┐
│ PiBun        [×]     │  ← Header (border-b)
├─────────────────────┤
│ PROJECTS       [+][↻]│  ← Section header
├─────────────────────┤
│ ▶ 📁 proj-a      2   │  ← Collapsible project group
│   ├── session-1       │  ← Active tab item (indented)
│   ├── session-2       │
│   ├── past-session-1  │  ← Past session (loaded)
│   └── Browse past…    │
│ ▸ 📁 proj-b      5   │  ← Collapsed project group
│ ▸ 📁 proj-c      1   │
│   [No projects yet]   │  ← Empty state
├─────────────────────┤
│ ── update footer ──  │  ← Auto-update status
└─────────────────────┘
```

**Key features:**
- **Project groups:** Collapsible tree. Each group shows favicon + name + session count.
- **UnifiedSession items:** Active tabs and past sessions rendered identically.
- **ProjectFavicon:** Fetches `/api/project-favicon?cwd=...` with folder icon fallback.
- **Add project:** Native folder picker (desktop) or inline text input (browser fallback).
- **Context menu:** Right-click → Open in Terminal, Open in Editor, Copy Path, Remove Project.
- **SessionBrowserDialog:** "Browse past sessions…" link opens full session browser.

**Session item styling:**
- Active: `border-l-2 border-accent-primary bg-surface-secondary text-text-primary`
- Inactive: `border-l-2 border-transparent text-text-tertiary hover:bg-surface-secondary/50`
- Shows: name (truncated), date, message count (`"235 msgs"`)

### 4.3 ContentTabBar (`ContentTabBar.tsx`, 545 lines)

Tab bar above the main content area.

**Visual structure:**
```
┌──────────────────────────────────────────┐
│ [💬 Pi] │ Terminal 1 │ Terminal 2 │ [+]  │  ← Active tab has bottom accent border
└──────────────────────────────────────────┘
```

**Features:**
- Chat tab always first, never closable
- Terminal tabs: double-click to rename inline, close button (disabled on last terminal)
- Context menu on terminal tabs: Rename, Close
- `[+]` creates new terminal in current project's CWD
- Per-project tab persistence (switching projects restores last active tab)

**Tab styling:**
- Active: `border-b-2 border-b-accent-primary bg-surface-primary text-text-primary`
- Inactive: `border-b-2 border-b-transparent bg-surface-base text-text-tertiary hover:bg-surface-primary/50`

### 4.4 ChatView (`ChatView.tsx`, 707 lines)

Virtualized scrollable message area using `react-virtuoso`.

**TimelineEntry types (render units):**
- `"message"` → UserMessage / AssistantMessage / SystemMessage
- `"tool-group"` → ToolExecutionCard (single tool_call + tool_result)
- `"work-group"` → WorkGroup (collapsible group of tool executions per turn)
- `"turn-divider"` → TurnDivider (timestamp + elapsed time + tool count + changed files)
- `"completion-summary"` → CompletionSummary ("✓ Worked for Xm Ys")

**Auto-scroll:** Pointer-aware via `useChatScroll` hook. Shows floating "↓ New messages" button when user scrolled up.

**Empty states:**
- No project → project picker
- Project active, no messages → "Ready to work"

### 4.5 ChatMessages (`chat/ChatMessages.tsx`, 994 lines)

Message renderers:

**UserMessage:**
- Right-aligned blue bubble
- `max-w-[85%] rounded-2xl bg-user-bubble-bg px-4 py-3 text-sm text-user-bubble-text`
- Pre-wrapped text (`whitespace-pre-wrap break-words leading-relaxed`)

**AssistantMessage:**
- Left-aligned
- **Thinking section:** Collapsible toggle, auto-expands while thinking streams, auto-collapses on content. Indigo tinted background. Character count badge when collapsed.
- **Content:** Markdown rendered via `MarkdownContent` with Shiki syntax highlighting + GFM
- **Streaming cursor:** Blinking block while streaming
- **Copy button:** Visible on hover, hidden while streaming

**SystemMessage:**
- Centered divider text
- Category-specific colors: compaction=amber, retry=amber/red, default=muted

**TurnDivider:**
- Subtle separator with badges: tool count, file changes (expandable list), elapsed duration, timestamp
- Diff view button, revert-to-here (fork) button

**Context menus:** Copy Text, Copy as Markdown, Fork from Here

### 4.6 ToolCards (`chat/ToolCards.tsx`, 489 lines)

**ToolExecutionCard** — unified card combining tool_call + tool_result:

**Three states:**
- `running` → blue border, pulse dot animation
- `success` → green check mark
- `error` → red X, red border

**Structure:**
```
┌─ 📄 read ─ src/index.ts ────────────── ✓ ─┐
│ (expanded body — ToolOutput renderer)        │
│   ┌──────────────────────────────────────┐  │
│   │ 1: import React from 'react'         │  │
│   │ 2: import { useState } from 'react'   │  │
│   │ ...                                   │  │
│   └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Collapsed view:** Shows first line of output + line count

**Tool icons:**
| Tool | Icon |
|------|------|
| bash | ⌘ |
| read | 📄 |
| edit | ✏️ |
| write | 📝 |
| glob | 🔍 |
| grep | 🔎 |
| other | 🔧 |

### 4.7 WorkGroup (`chat/WorkGroup.tsx`, 318 lines)

Collapsible group of consecutive tool executions within a single turn.

- Auto-expands when any tool is running
- Defaults collapsed when ≥2 tools and all complete
- Single-tool groups render directly (no wrapper)
- Collapsed: compact list with status dots + tool name + one-line summary
- Max 6 entries visible when collapsed (scrollable list)

### 4.8 ToolOutput (`chat/ToolOutput.tsx`, 611 lines)

Dispatcher + specialized renderers:

| Tool | Renderer | Visual |
|------|----------|--------|
| `bash` | BashOutput | Terminal-styled container with dots header, `$` command, monospace output |
| `read` | ReadOutput | File header (icon + name + line range), syntax-highlighted content via CodeBlock |
| `edit` | EditOutput | Unified diff: red removed lines, green added lines, separator, collapsible for large diffs |
| `write` | WriteOutput | File header ("written" badge), syntax-highlighted preview, collapsible for large files |
| other | DefaultOutput | Raw preformatted text |

### 4.9 Composer (`Composer.tsx`, 1653 lines)

Multi-line input with rich features.

**Visual structure:**
```
┌─────────────────────────────────────────────────┐
│ [📎 image1] [📎 image2] [📁 src/index.ts] [×]  │  ← Attachment chips
├─────────────────────────────────────────────────┤
│                                                 │
│  Type a message... (paste or drop images)        │  ← Textarea
│                                                 │
├─────────────────────────────────────────────────┤
│                    [⬆ Send]                      │  ← Action buttons
└─────────────────────────────────────────────────┘
```

**Input modes:**
- **Idle:** Enter to send, Shift+Enter for newline
- **Streaming:** Enter to steer, Ctrl+Enter for follow-up
- **Abort button:** Visible during streaming

**Features:**
- Auto-resize textarea (max 200px height)
- `/` slash command menu (Pi slash commands + inline model picker via `/model`)
- `@` file mention autocomplete (debounced file search, shown as removable chips)
- Image paste/drop (clipboard + drag-and-drop, preview strip, max 10 images)
- Terminal context chips (selected terminal text as `<terminal_context>` blocks)
- Draft persistence per tab (survives tab switch + page reload)
- Auto-starts Pi session on first prompt

### 4.10 ModelSelector (`ModelSelector.tsx`, 338 lines)

Dropdown button showing current model. On click, opens panel listing all models grouped by provider. Selecting a model calls `session.setModel`. Models fetched via `session.getModels` on first open.

### 4.11 ThinkingSelector

Dropdown for thinking level: off, minimal, low, medium, high, xhigh.

### 4.12 ThemeSelector (`ThemeSelector.tsx`)

Grid picker for 5 built-in themes. Persisted to localStorage.

### 4.13 GitStatusBar (`GitStatusBar.tsx`, 110 lines)

Shows branch name + changed file count in the toolbar. Clicking toggles the git panel.

```
[⎇ main (3)]    ← branch name + changed count badge
```

### 4.14 SessionStats (`SessionStats.tsx`, 245 lines)

Compact token + cost display in toolbar. Click for detailed breakdown (input/output/cache tokens + cost).

```
[45.3k tokens · $0.12]    ← compact view
```

### 4.15 ConnectionBanner (`ConnectionBanner.tsx`, 36 lines)

Top banner for WS status:
- `connecting` → yellow, "Connecting to server…"
- `reconnecting` → yellow, "Reconnecting (attempt N)…"
- `closed` / `disposed` → red, "Disconnected from server"
- `open` → hidden

### 4.16 Markdown + CodeBlock

- **Markdown** (`Markdown.tsx`, 444 lines): `react-markdown` + `remark-gfm`. Fenced code blocks rendered via Shiki's `CodeBlock`. File path links resolved and clickable (open in editor).
- **CodeBlock** (`CodeBlock.tsx`, 144 lines): Shiki syntax highlighting (async, lazy). Copy button + language label. Theme-aware (re-highlights on theme switch).

### 4.17 DiffPanel + DiffViewer

- **DiffPanel:** Right side panel, toggled via Ctrl+D. Stacked or split view of per-turn diffs.
- **DiffViewer:** Syntax-highlighted unified diff rendering (red/green lines).

### 4.18 GitPanel

Collapsible panel above chat showing changed files list. Toggled by clicking GitStatusBar or Ctrl+G.

### 4.19 TerminalInstance

Full-height embedded xterm.js terminal. One instance per terminal tab. Preserved via `hidden` (not unmounted) during tab switches.

### 4.20 Modal dialogs

| Dialog | Purpose |
|--------|---------|
| SettingsDialog | Global settings (model, thinking, keybindings) |
| ForkDialog | Fork session from a previous message |
| ExportDialog | Export session to HTML (native save dialog in desktop) |
| SessionBrowserDialog | Browse and resume past sessions |
| SetupScreen | Pi CLI installation onboarding |
| ImagePreviewModal | Full-size image preview overlay |
| ToastContainer | Toast notifications (bottom-right) |

---

## 5. State Management

**Zustand** with slice pattern — `create<AppStore>()` composed from:
- `createAppSlice` — connection, UI, projects, git, terminals, notifications, update, workspace, plugins
- `createSessionSlice` — session, messages, models, extension UI, prerequisites

### ChatMessage type
```typescript
interface ChatMessage {
  id: string;
  timestamp: number;
  type: "user" | "assistant" | "tool_call" | "tool_result" | "system";
  content: string;           // accumulated text (delta for streaming)
  thinking: string;           // accumulated thinking (delta for streaming)
  toolCall: ChatToolCall | null;
  toolResult: ChatToolResult | null;
  streaming: boolean;
}
```

### Key state slices

| Slice | State |
|-------|-------|
| **Connection** | `connectionStatus`, `reconnectAttempt`, `lastError`, `healthIssues` |
| **UI** | `sidebarOpen`, `activeTabId`, `activeContentTab`, `isWindowFocused` |
| **Session** | `tabs`, `messages`, `sessionId`, `piSessionId`, `streaming`, `sessionName` |
| **Projects** | `projects`, `activeProjectId` |
| **Git** | `gitIsRepo`, `gitBranch`, `gitChangedFiles`, `gitIsDirty`, `gitPanelOpen` |
| **Terminals** | `terminalTabs`, per-project |
| **Models** | `availableModels`, `currentModel`, `thinkingLevel` |
| **Notifications** | `toasts` |

---

## 6. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+B | Toggle sidebar |
| Ctrl+L | Toggle model selector |
| Ctrl+D | Toggle diff panel |
| Ctrl+T | New session |
| Ctrl+Shift+B | Toggle bash input |
| Ctrl+, | Open settings |
| Ctrl+G | Toggle git panel |

Customizable via `~/.pibun/keybindings.json`.

---

## 7. Tech Stack (pibun)

| Item | Value |
|------|-------|
| React | 19 |
| Zustand | 5.0.12 |
| Tailwind CSS | v4 (`@tailwindcss/vite`) |
| Shiki | `shiki/bundle/web` |
| react-virtuoso | Virtual scrolling |
| react-markdown | Markdown rendering |
| remark-gfm | GFM support |
| xterm.js | Terminal emulation |
| Bun | Runtime |
| TypeScript | 5.9.3 |
| Vite | Build tool |

---

## 8. Mapping to Sakti (React → SolidJS)

| pibun | Sakti equivalent |
|-------|-----------------|
| React 19 | SolidJS |
| Zustand (slices) | SolidJS signals / stores |
| `useStore((s) => s.field)` | `createSignal` / derived stores |
| `memo()` | SolidJS is already fine-grained (no memo needed) |
| `react-virtuoso` | `@thisbeyond/solid-dnd` or custom virtual list |
| `react-markdown` | `solid-markdown` or custom |
| `useState` / `useCallback` | `createSignal` / plain functions |
| `useEffect` | `createEffect` / `onMount` |
| `useMemo` | `createMemo` |
| `useRef` | SolidJS refs or `let` variables in JSX |
| Tailwind v4 | Keep as-is (CSS framework, framework-agnostic) |
| className (React) | `class` (SolidJS, per AGENTS.md convention) |
| `index.css` theme tokens | Port directly — CSS custom properties are framework-agnostic |

### State management approach for Sakti
- Use SolidJS signals/store pattern (not Zustand)
- `ChatMessage` type stays the same (it's plain TypeScript)
- WebSocket event handling via `createEffect` + store updates
- Transport abstraction: reuse the same pattern (abstract WS transport)

---

## 9. Components NOT needed for Sakti v1 (plugin/extension system)

These can be omitted from initial Sakti UI build:
- `PluginManager`, `PluginPanel`, `PluginSidebarPanels`, `PluginBottomPanels`, `PluginRightPanels`
- `ExtensionDialog`, `ExtensionWidgets`
- `StatusBar` (extension status indicators)
- `pluginMessageBridge.ts`

---

## 10. Implementation Priority Suggestion

### Phase 1: Shell
1. Theme tokens CSS (`index.css`)
2. Theme system (`themes.ts`)
3. `AppShell` layout (sidebar + main area, no content)
4. `Sidebar` (project list, session list)
5. `ContentTabBar` (chat + terminal tabs)

### Phase 2: Chat
6. `ChatView` (virtualized scroll)
7. `ChatMessages` (user/assistant/system messages)
8. `Markdown` + `CodeBlock`
9. `ToolCards` + `WorkGroup` + `ToolOutput`
10. `TurnDivider`

### Phase 3: Input
11. `Composer` (multi-line input, send/steer/abort)
12. `ComposerCommandMenu` (slash commands, file mentions)
13. Image paste support

### Phase 4: Toolbars & Panels
14. `ModelSelector` + `ThinkingSelector`
15. `GitStatusBar` + `GitPanel`
16. `SessionStats`
17. `DiffPanel` + `DiffViewer`
18. `ConnectionBanner` + `ErrorBanner`

### Phase 5: Dialogs & Polish
19. `SettingsDialog`
20. `ForkDialog` + `ExportDialog`
21. `TerminalInstance` (xterm.js)
22. Keyboard shortcuts
23. Draft persistence
