## Why

The current workspace shows a dead-end "Ready to work on [project]" stub when no session is selected. Users have no way to discuss features, research the codebase, or plan work before jumping into a coding session. Every coding agent project needs a persistent "intake" channel — a project brain that accumulates knowledge over the project's lifetime, where users chat about new features and bug fixes, and new task sessions are spun off when plans are locked in.

## What Changes

- **Intake sessions**: Add `kind` column to `sessions` table (`'intake' | 'task'`). Each project gets exactly one lazy intake session, upserted on first open. The intake session persists forever, accumulating project knowledge (compacted when needed).
- **Intake upsert endpoint**: `POST /api/projects/:id/intake-session` — finds existing or creates the project's intake session.
- **`propose_session` tool**: New tool in `packages/tools/`. The intake agent calls it with `{ title, message }` when a plan is ready. The tool is a no-op server-side (returns `{ status: "proposed" }`), terminates the agent run, and signals the client to show a confirm UI. On user confirm, the client creates a task session and sends the pre-filled message as the first prompt.
- **Intake agent system prompt**: Distinct prompt for `kind: 'intake'` sessions. Full toolset (read, write, edit, bash, grep, find, ls). Role: project PM — discusses features, researches, writes rough change-request `.md` docs, calls `propose_session` when ready.
- **Chat input component** (ported from reference): Auto-resize textarea (24→200px), Enter=send / Shift+Enter=newline, model selector button, send button with spinner, input footer with char count. Defer: permissions, @context file search, Plan/Build toggle.
- **Model selector command center** (ported from reference): Full `ModelSelector` dialog with `/model` mode — virtual-list model browser (40px rows, overscan), grouped by provider, Connected/Not Connected sections, keyboard navigation (ArrowUp/Down, Enter, Escape), MiniSearch-powered fuzzy search. Built on Kobalte `CommandDialog`. Defer: `/mcp`, `/skills`, `/command`, `@context` modes.
- **Provider selection store** (ported + adapted): MiniSearch full-text index over the model catalog, custom scoring (provider focus, name/id/prefix/contains, loose search), provider aliases (zai ↔ z.ai, kimi ↔ moonshot), search caches, provider-grouped sections. Adapted to fetch from current API endpoints (`/api/available-models`, `/api/auth`) instead of the old `ProviderClient`. Model selection persists per-session via `updateSession`.
- **Message rendering system** (ported from reference): Parts registry (`text`, `tool`, `reasoning` for MVP) with `Part` dispatcher, tool rendering subsystem (`ToolPart` → `ToolSummaryRow` with per-tool formatters, `BasicTool` collapsible). Defer: `permission`, `question`, `notice`, `retry`, `action_buttons`, `workflow_summary` parts.
- **Velomark integration**: Wire `packages/velomark/` as a workspace package (exports → `./src/index.tsx`, CSS → `./src/theme/styles.css`). Desktop gets a `DesktopMarkdownRenderer` wrapper that maps CSS tokens to velomark's theme system.
- **Onboarding panel**: Replaces `NoSessionSelected` stub. Shows when intake session is active. Structure: welcome panel (empty state with suggestions) + message timeline (renders intake conversation) + chat input. Bound to the intake session's `SessionStore`.
- **Workspace integration**: On project open → upsert intake session → set tab `sessionId` to intake. Sidebar shows task sessions (intake is implicit). Tab bar shows intake with project name. `propose_session` tool call → inline confirm panel in timeline → on confirm, switch tab + send pre-filled prompt.
- **Turn projection**: Port `buildChatTurns` projection from the reference — transforms flat `UIMessage[]` + tool calls into `ChatTurn[]` (user message + assistant response pairs with chronological parts).

## Capabilities

### New Capabilities
- `intake-sessions`: Persistent per-project intake sessions with upsert lifecycle, `kind` column on sessions table, distinct agent system prompt, and `propose_session` tool for dispatching task sessions with user-confirmed pre-filled briefs.
- `chat-input`: Auto-resize textarea chat input with model selector button, send button, input footer. Ported from reference with slash-command detection stub for `/model`.
- `model-selector`: Full command center dialog with `/model` mode — MiniSearch-powered fuzzy search, virtual-list model browser, provider grouping, keyboard navigation. Adapted to current API endpoints.
- `message-rendering`: Parts-based message rendering system with registry pattern, velomark-powered markdown, tool rendering subsystem. Ported from reference.

### Modified Capabilities
- `agent-streaming`: The runner resolves the system prompt based on session `kind`. Intake sessions get the intake agent prompt + `propose_session` tool in addition to the standard toolset.

## Impact

- **Database**: Migration adds `kind TEXT NOT NULL DEFAULT 'task'` to `sessions` table.
- **Server**: New `POST /api/projects/:id/intake-session` route. `POST /api/sessions` accepts optional `kind` and `parentSessionId`. Runner resolves system prompt by session kind.
- **packages/tools**: New `propose_session` tool.
- **packages/velomark**: `package.json` exports updated to workspace TS resolution (`./src/index.tsx`).
- **packages/agent**: System prompt resolution by session kind.
- **apps/desktop**: New components: chat input, model selector, provider selection store, message timeline, parts system, velomark wrapper, onboarding panel. Modified: workspace-layout (intake upsert + view switching), session-registry (intake session), event-reducer (propose_session handling).
- **Dependencies**: `minisearch` added to desktop for fuzzy model search. Velomark's deps (shiki, katex, mermaid) resolve from workspace install.
