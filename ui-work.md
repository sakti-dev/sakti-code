## What We've Done

**Backend (complete):**

- Elysia REST server with 20+ route modules
- Agent core (loop, tools, compaction, streaming events)
- DB layer (Drizzle + node:sqlite)
- Eden typed WS with TypeBox schemas

**Frontend stores (complete, 13 test files, 98+124 tests passing):**

- `server-store`, `session-store`/`registry`, `terminal-store`/`registry`
- `ws-client` (auto-reconnect, frame dispatch), `event-reducer`, `token-batcher`
- `actions` (loadProjects, createSession, sendPrompt, abort, steer, followUp)
- `store-context` (SolidJS context wiring), `ui-signals` (sidebar toggle, active view)

**CSS theme system (complete):**

- Full OKLCH light/dark tokens, Kobalte `ColorModeProvider`, Tailwind v4

**Layout shells (skeleton only):**

- `AppShell`, `Sidebar`, `Toolbar`, `ContentTabBar` — all placeholders with label text
- 3 functional banners: `ConnectionBanner`, `ErrorBanner`, `UpdateBanner`

**What's missing:** The entire UI is placeholder skeletons. Zero functional components.

---

## What to Build Next — Ranked Easiest First

| Rank   | Component                                                           | Why Easy                                                                                                                                                       | Dependencies                                    | Effort  |
| ------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| **1**  | **UI Primitives** (`Badge`, `Tooltip`, `ScrollArea`, `Separator`)   | Pure CSS/styling, zero store logic, no interactivity. Tailwind classes only.                                                                                   | CSS tokens (done)                               | ~30 min |
| **2**  | **`GitStatusBar`**                                                  | Read-only badge showing branch name + changed count from `connectionStore`. One signal read, one conditional render.                                           | Stores (done)                                   | ~30 min |
| **3**  | **`SessionStats`**                                                  | Read-only compact display: token count + cost. Reads `session.stats`. Click expands detail.                                                                    | Stores (done)                                   | ~45 min |
| **4**  | **`ModelSelector`**                                                 | Dropdown listing models grouped by provider. Fetches on first open, calls `actions.setModel`. Simple state machine (closed/open/loading).                      | `DropdownMenu` primitive, `server-store` (done) | ~1 hr   |
| **5**  | **`ThinkingSelector`**                                              | Dropdown for 6 thinking levels. Even simpler than ModelSelector — static list, one signal.                                                                     | `DropdownMenu` primitive                        | ~30 min |
| **6**  | **Sidebar: Project/Session lists**                                  | Data-driven tree from `server-store`. Collapsible groups, active-item highlight, click to switch. No new store logic.                                          | Stores (done)                                   | ~2 hr   |
| **7**  | **`Composer` (basic)**                                              | Multi-line textarea, auto-resize, Enter to send, Shift+Enter newline. Calls `actions.sendPrompt`. No slash commands or `@` mentions yet.                       | `actions` (done)                                | ~1.5 hr |
| **8**  | **`ChatView` + Message renderers**                                  | Virtualized scroll, UserMessage (blue bubble), AssistantMessage (markdown), SystemMessage (centered divider). Needs `solid-virtuoso` or custom virtual scroll. | Virtual scroll lib, `markdown` (see #10)        | ~3 hr   |
| **9**  | **`ToolCards` + `WorkGroup`**                                       | Tool execution cards with running/success/error states, collapsible groups. Reads `tool_call`/`tool_result` parts from `UIMessage`.                            | Message renderers (done in #8)                  | ~2 hr   |
| **10** | **Markdown + CodeBlock**                                            | `solid-markdown` + remark-gfm + Shiki syntax highlighting. Theme-aware. Copy button on code blocks.                                                            | Shiki (lazy load), theme tokens (done)          | ~2 hr   |
| **11** | **`ContentTabBar` (functional)**                                    | Chat tab always first + terminal tabs. Double-click rename, close button, `[+]` new terminal. Per-project persistence via `ui-signals`.                        | `ui-signals` (done)                             | ~1.5 hr |
| **12** | **`TurnDivider`**                                                   | Subtle separator with tool count badge, elapsed time, timestamp. Minimal logic.                                                                                | Stores (done)                                   | ~45 min |
| **13** | **`ConnectionBanner` improvements**                                 | Already exists — just needs reconnect-attempt count display and styling polish.                                                                                | Already built                                   | ~15 min |
| **14** | **Keyboard shortcuts**                                              | Global `keydown` listener dispatching to store actions. Ctrl+B sidebar, Ctrl+T new session, etc.                                                               | Stores (done)                                   | ~1 hr   |
| **15** | **`DiffPanel` + `DiffViewer`**                                      | Right-side panel showing per-turn file diffs. Needs `gitRoutes.turnDiff` integration.                                                                          | Git API (done server-side)                      | ~2 hr   |
| **16** | **`GitPanel`**                                                      | Collapsible panel above chat listing changed files. Click to expand per-file diff.                                                                             | `DiffViewer` (#15)                              | ~1.5 hr |
| **17** | **`SettingsDialog`**                                                | Modal for global settings (default model, thinking level, keybindings). Reads/writes `settingsRoutes`.                                                         | `Dialog` primitive                              | ~2 hr   |
| **18** | **`TerminalInstance`**                                              | Embedded xterm.js terminal. Needs xterm.js + fit addon + WebSocket PTY bridge.                                                                                 | xterm.js, PTY backend (new?)                    | ~3 hr   |
| **19** | **`Composer` advanced** (slash commands, `@` mentions, image paste) | Autocomplete menu, debounced file search, clipboard/drag-drop image handling, draft persistence.                                                               | File search API (new?), `Composer` basic (#7)   | ~4 hr   |
| **20** | **`ForkDialog` + `ExportDialog`**                                   | Modal dialogs calling `actions.fork` and `actions.exportHtml`.                                                                                                 | `Dialog` primitive, `actions` (done)            | ~1.5 hr |

---

## My Recommendation: Start with 1-6

**Batch 1 (quick wins, ~2 hrs total):**

1. UI Primitives — foundation for everything
2. GitStatusBar — instant visible value
3. SessionStats — instant visible value
4. ThinkingSelector — simple dropdown

**Batch 2 (sidebar + input, ~3.5 hrs):** 5. ModelSelector — dropdown with async fetch 6. Sidebar project/session lists — the app becomes usable

After batch 2, you have a functional sidebar + toolbar and can start sending messages. Then batch 3 (Composer + ChatView + Markdown) makes it a real chat app.

Want me to start with Batch 1?
