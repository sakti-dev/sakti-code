# Sakti v1 — Product Requirements Document

## 1. Product Vision & Goals

Sakti is a **native desktop coding agent** that runs multiple AI coding agents concurrently on different codebases. Unlike wrapper apps that shell out to external CLIs, Sakti owns the full agent loop in-process — built on top of `@earendil-works/pi-ai` for LLM streaming with its own agent core, persistence, and tool execution.

**v1 goal:** Achieve feature parity with the [pibun](openspec/references/pibun/) reference implementation — a mature desktop coding agent UI — while leveraging Sakti's in-process architecture advantages. Target platform is **Linux** (Electrobun). macOS and Windows support may follow.

### Key architectural differentiator vs pibun

| Aspect | pibun | Sakti |
|--------|-------|-------|
| Agent runtime | Subprocess RPC (`pi --mode rpc`) | In-process (`@earendil-works/pi-ai`) |
| Persistence | Delegated to Pi subprocess | Owned via `bun:sqlite` + Drizzle ORM |
| Server framework | Raw `Bun.serve()` | Elysia with Eden treaty (type-safe REST) |
| Frontend framework | React 19 | SolidJS |
| Tool execution | Delegated to Pi | Self-managed (7 tools in `packages/tools`) |

---

## 2. User Personas

**Primary user:** A developer who wants a desktop AI coding assistant that:
- Runs locally, connecting to LLM providers via API keys
- Works on their actual codebases (reads, writes, edits files)
- Provides real-time streaming feedback on agent actions
- Manages multiple concurrent coding sessions across projects
- Integrates with their git workflow and terminal

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Electrobun Desktop Shell (apps/app)             │
│  ┌─────────────────────────────────────────────┐ │
│  │  SolidJS App (Vite → CEF webview)           │ │
│  │  ┌───────────┐  ┌──────────┐  ┌─────────┐ │ │
│  │  │ ChatView  │  │ Sidebar  │  │ Terminal│ │ │
│  │  │ Composer  │  │ Settings │  │  Tabs   │ │ │
│  │  │ GitPanel  │  │  Dialog  │  │         │ │ │
│  │  └─────┬─────┘  └────┬─────┘  └────┬────┘ │ │
│  └────────┼──────────────┼──────────────┼───────┘ │
│           │  REST (Eden)  │    WS (/ws)  │        │
└───────────┼──────────────┼──────────────┼────────┘
            ▼              ▼              ▼
┌─────────────────────────────────────────────────┐
│  Elysia Server (apps/server)                     │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │ REST     │ │ WS Agent     │ │ Terminal    │ │
│  │ Routes   │ │ Streaming    │ │ Manager     │ │
│  │ (20+)    │ │ (/ws)        │ │ (bun-pty)   │ │
│  └────┬─────┘ └──────┬───────┘ └──────┬──────┘ │
│       │              │                │         │
│  ┌────▼──────────────▼────────────────▼──────┐  │
│  │  ServerContext (repos, config, state)      │  │
│  └────┬──────────┬─────────────┬─────────────┘  │
└───────┼──────────┼─────────────┼────────────────┘
        ▼          ▼             ▼
┌───────────┐ ┌──────────┐ ┌──────────┐
│ packages/ │ │ packages/│ │ packages/│
│ db        │ │ agent    │ │ tools    │
│ (SQLite)  │ │ (loop)   │ │ (7 tools)│
└───────────┘ └────┬─────┘ └──────────┘
                  ▼
          ┌──────────────┐
          │ @earendil-   │
          │ works/pi-ai  │
          │ (LLM stream) │
          └──────────────┘
```

**Data flow:**
1. User sends prompt via WS → server resolves model, creates agent loop → streams `AgentEvent`s back over WS
2. Agent loop executes tools → tool results persisted to SQLite → events pushed to client
3. REST routes handle CRUD (projects, sessions, settings, model config, costs, git, compaction)
4. Terminal manager creates PTY processes → output pushed over WS to client

---

## 4. Functional Requirements

### 4.1 Project Management

- **FR-PM-01:** Create, rename, update, and delete projects
- **FR-PM-02:** Open a project by selecting a directory (native file dialog)
- **FR-PM-03:** Display project list in sidebar with name, path, and session count
- **FR-PM-04:** Auto-detect project favicons from well-known icon files (favicon.ico, logo.svg, etc.)
- **FR-PM-05:** Per-project default model configuration (provider + model + thinking level)
- **FR-PM-06:** File search within project directory for `@` file mentions in the composer

### 4.2 Session Management

- **FR-SM-01:** Create new sessions within a project
- **FR-SM-02:** List sessions grouped by project with title, model, creation date
- **FR-SM-03:** Rename sessions (manual or auto-generated from conversation topic)
- **FR-SM-04:** Delete sessions
- **FR-SM-05:** Fork a session from a previous message (copies message history up to that point)
- **FR-SM-06:** Export sessions as HTML, Markdown, or JSON (native save dialog)
- **FR-SM-07:** Persist workspace session list across app restarts
- **FR-SM-08:** Display session metadata: model used, message count, cost, duration

### 4.3 Chat Interface

- **FR-CI-01:** Multi-session tab interface — each tab is an independent agent session
- **FR-CI-02:** Streaming display of assistant responses:
  - Text deltas (typing effect)
  - Thinking/reasoning blocks (collapsible)
  - Tool call invocations with real-time progress
- **FR-CI-03:** Three input modes:
  - **Prompt** — start a new agent turn
  - **Steer** — send guidance while the agent is actively streaming
  - **Follow-up** — send additional context after a turn completes
- **FR-CI-04:** Composer input with:
  - Multi-line text entry
  - `@` file mention autocomplete (file search within project)
  - Image paste support (base64-encoded in prompt)
  - Slash command prefix detection
- **FR-CI-05:** Virtual scrolling for long conversations (efficient rendering of 1000+ messages)
- **FR-CI-06:** Syntax-highlighted code blocks with copy button and language label
- **FR-CI-07:** Markdown rendering with link handling (open in default browser)
- **FR-CI-08:** Auto-scroll to latest message (with manual scroll-up pause)
- **FR-CI-09:** Session title display in tab and sidebar

### 4.4 Tool Execution Display

- **FR-TD-01:** Show tool calls as they execute in the message stream
- **FR-TD-02:** Display tool name, arguments, and progress (especially for bash commands with streaming output)
- **FR-TD-03:** Show tool results: success (output preview), error (error message), duration
- **FR-TD-04:** Collapsible tool execution blocks (expanded during execution, collapsed on completion)
- **FR-TD-05:** Visual distinction between different tool types (read, write, edit, bash, grep, find, ls)
- **FR-TD-06:** Display which files were read/written/edited with diff previews for edits

### 4.5 Terminal Integration

- **FR-TI-01:** Built-in terminal tabs alongside chat tabs in the main content area
- **FR-TI-02:** Terminals scoped to project (not session) — switching sessions within the same project keeps terminals alive
- **FR-TI-03:** Full PTY terminal emulation (input, output, ANSI escape codes)
- **FR-TI-04:** Terminal management: create, close, rename tabs
- **FR-TI-05:** Terminal resize handling (window resize → PTY resize)

### 4.6 Git Integration

- **FR-GI-01:** Git status bar in chat view (current branch, changed files count)
- **FR-GI-02:** Git diff viewer — show diffs for changed files
- **FR-GI-03:** Git branch display and switching
- **FR-GI-04:** Git log viewer (recent commits)
- **FR-GI-05:** Per-turn diffs — show file changes made during each agent turn
- **FR-GI-06:** Diff panel as a collapsible sidebar or overlay

### 4.7 Model Management

- **FR-MM-01:** Model selector in chat interface (dropdown or popover)
- **FR-MM-02:** Display available models grouped by provider (all providers supported by pi-ai)
- **FR-MM-03:** Thinking level selector: off, minimal, low, medium, high, xhigh
- **FR-MM-04:** Per-project model configuration (persisted in DB)
- **FR-MM-05:** Global default model configuration (fallback when no project-specific config)
- **FR-MM-06:** Cost display per session (input/output tokens + estimated USD cost)

### 4.8 Settings

- **FR-ST-01:** Global settings dialog (accessible from app menu)
- **FR-ST-02:** Per-session settings (model, thinking level — overridable per session)
- **FR-ST-03:** Customizable keybindings (stored in user config file, e.g. `~/.sakti/keybindings.json`)
- **FR-ST-04:** Default keybindings matching common IDE conventions

### 4.9 Theming

- **FR-TH-01:** Dark theme (default)
- **FR-TH-02:** Light theme
- **FR-TH-03:** Follow system dark/light preference (auto-switch)
- **FR-TH-04:** CSS custom properties for all theme tokens (colors, backgrounds, borders, text)
- **FR-TH-05:** Theme persisted across app restarts

### 4.10 Desktop Features (Electrobun)

- **FR-DF-01:** Native desktop window with size/position persistence across restarts
- **FR-DF-02:** System tray icon with session status indicators
- **FR-DF-03:** Native notifications when agent finishes a turn while app is unfocused
- **FR-DF-04:** Native file dialogs:
  - Folder picker (for opening projects)
  - Save dialog (for session export)
- **FR-DF-05:** Application menu with keyboard shortcuts (File, Edit, View, Window, Help)
- **FR-DF-06:** Standard window controls (minimize, maximize, close)

### 4.11 Slash Commands

- **FR-SC-01:** Detect `/` prefix in composer input
- **FR-SC-02:** Show slash command autocomplete dropdown
- **FR-SC-03:** Execute slash commands via the agent system (delegated to pi-ai extensions)

### 4.12 Connection & Status

- **FR-CS-01:** Connection status banner (connected/disconnected/reconnecting to server)
- **FR-CS-02:** Error banners for agent errors, tool failures, API key issues
- **FR-CS-03:** Session status indicators (running, idle, error)
- **FR-CS-04:** Auto-reconnect to server on disconnect

---

## 5. Non-Functional Requirements

### 5.1 Performance

- **NFR-P01:** Virtual scrolling must handle 1000+ messages without frame drops (>30fps)
- **NFR-P02:** Streaming latency: first token displayed within 500ms of LLM response start
- **NFR-P03:** Tool execution updates rendered in real-time (no batching delay visible to user)
- **NFR-P04:** App startup time < 3 seconds on modern hardware

### 5.2 Reliability

- **NFR-R01:** Server crash does not lose data — all messages and state persisted to SQLite before streaming
- **NFR-R02:** WebSocket auto-reconnect with session resumption on connection loss
- **NFR-R03:** Agent abort cleanly terminates tool execution (no orphan processes)
- **NFR-R04:** Graceful degradation: compaction failure returns original messages unchanged

### 5.3 Usability

- **NFR-U01:** Full keyboard navigation support (all interactions accessible via keyboard)
- **NFR-U02:** Responsive layout that works well at common window sizes (1280x720 minimum)
- **NFR-U03:** Clear visual hierarchy: chat content > tool execution > metadata
- **NFR-U04:** Consistent spacing, typography, and color usage across all views

### 5.4 Accessibility

- **NFR-A01:** Semantic HTML elements throughout
- **NFR-A02:** Sufficient color contrast ratios (WCAG AA)
- **NFR-A03:** Focus indicators on all interactive elements

---

## 6. Technical Constraints

| Constraint | Value |
|-----------|-------|
| Frontend framework | SolidJS (required, not React) |
| Server framework | Elysia (REST + WebSocket) |
| Database | `bun:sqlite` + Drizzle ORM |
| LLM provider | `@earendil-works/pi-ai` (no hand-rolled provider code) |
| Desktop framework | Electrobun |
| Runtime | Bun |
| Target platform | Linux (v1) |
| TypeScript | 6.0.3, strict mode, `exactOptionalPropertyTypes` |
| State management | SolidJS signals (not Zustand or Redux) |
| Styling | CSS with custom properties (no Tailwind — TBD, confirm with user) |
| WS protocol | JSON frames over `/ws` |
| REST typing | Eden treaty client (`apps/app/src/lib/api.ts`) |

---

## 7. Out of Scope for v1

| Feature | Reason |
|---------|--------|
| Plugin system (sandboxed iframe) | Complex; no established need for v1 |
| Auto-updater | Distribution not finalized for v1 |
| Custom themes beyond dark/light | 2 themes sufficient for v1 |
| Multi-workspace windows | Single window is sufficient |
| Session sharing/collaboration | Local-only for v1 |
| Mobile support | Desktop-only app |

---

## 8. Success Metrics

- [ ] All 20+ REST routes consumed by at least one UI component
- [ ] WebSocket streaming fully functional (prompt, steer, follow-up, abort)
- [ ] Multi-session chat with tab switching works smoothly
- [ ] All 7 coding tools display execution in real-time
- [ ] Built-in terminal tabs functional with PTY
- [ ] Git status, diff, branch, log all accessible from UI
- [ ] Model selection and thinking level control working for all pi-ai providers
- [ ] Dark and light themes switchable with system preference following
- [ ] Session forking, export, rename working
- [ ] Desktop features (window management, tray, notifications, file dialogs) functional on Linux
- [ ] Clean build and install on Linux
- [ ] No console errors or warnings in production build
