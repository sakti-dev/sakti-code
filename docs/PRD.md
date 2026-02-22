# sakti-code Product Requirements Document (PRD)

## 1. Overview

- **Product**: sakti-code — an offline-first AI coding agent desktop app.
- **Platform**: Electron shell with SolidJS renderer, Mastra orchestration, TanStack AI chat client, Hono (main process) HTTP/SSE bridge.
- **Value**: Fast, secure, local-first agent that can read/write code, run tools/tests, and stream results with human-in-the-loop approvals.

## 2. Goals & Success Criteria

- **G1: Fast feedback** – sub-200ms token latency from LLM to UI; tool stdout streamed within 300ms of availability.
- **G2: Safe operations** – all privileged actions gated by approvals and scoped to workspace; zero writes outside workspace.
- **G3: Reliability** – resilient streaming (reconnect), cancellable runs, and deterministic tool responses.
- **G4: Developer trust** – transparent plans/diffs, preview before apply, structured tool outputs, no silent mutations.
- **G5: Local-first** – runs without remote services except LLM/model endpoints; no open ports beyond loopback.

## 3. Users & Personas

- **Solo developer**: wants quick fixes, refactors, and tests locally.
- **Team developer**: uses agent for feature work with approvals and auditability.
- **Reviewer**: inspects diffs and logs to validate agent actions before applying.

## 4. Scope (Must-Haves)

- Desktop app (Win/macOS/Linux) with secure renderer (no Node), preload bridge only.
- Local Hono server in main process (loopback-only, random port, bearer token auth).
- Chat UI with TanStack AI `useChat` over SSE, streaming Mastra events mapped to TanStack StreamChunks.
- Mastra agent(s) with tools: filesystem (read/write/applyPatch/list), shell (run command), git (status/diff/commit optional), memory recall.
- Tool approval flow (pause/resume) surfaced in UI; user can approve/deny.
- Cancellation/Stop that aborts LLM and kills child processes.
- File watcher -> IPC push events to renderer.
- Workspace sandboxing (path canonicalization, deny traversal/upwards writes).
- Persistence for auth token/port only in-memory; regenerated on app start.
- Basic settings: select workspace folder, choose model/provider, toggle telemetry (default off).

## 5. Out of Scope (v1)

- Multi-window UI; only primary window.
- Cloud sync of memories; v1 is local only.
- Auto-update pipeline.
- Collaboration/multi-user sessions.

## 6. Functional Requirements

### 6.1 Chat & Streaming

- Start chat sessions with history; send messages to `/api/chat` SSE endpoint.
- Receive TanStack StreamChunks: `content`, `thinking`, `tool_call`, `tool_result`, `approval-requested`, `error`, `done`.
- Display partial responses as they stream; render code blocks with copy + insert options.
- “Stop” cancels fetch abort signal and terminates active tool processes.

### 6.2 Tooling & Approvals

- Mastra agent configured with `requireToolApproval`. On approval request:
  - UI shows pending tool call (type, command/file target, diff preview if available).
  - User Approve/Decline; server resumes or aborts stream accordingly.
- Shell tool streams stdout/stderr incrementally with exit code & duration JSON envelope.
- Filesystem tool supports `readFile`, `writeFile`, `applyPatch`, `listDir`, and refuses paths outside workspace.
- Git tool (optional) exposes `status`, `diff`, `commit` with structured responses; never auto-commit without explicit user action.

### 6.3 Memory Layer

- Provide long-term memory for best practices and project rules.
- Two acceptable backends:
  1. **Stdio Python + Chroma/fast-embed** (NDJSON over stdio; single child process; per-project collection path in app data).
  2. **libSQL** schema (`memories`, `memory_tags`, `memory_embeddings`) with embeddings in Node and cosine similarity in JS.
- Memory features: types (`best_practice`, `anti_pattern`, `gotcha`, `heuristic`, `example`), confidence (0–1), scope (global/project), tags, last_used_at.
- Retrieval tool `recall_best_practices` with optional topic filter and min confidence.
- Future: confidence decay and query rewriting (not required for v1 but design should allow).

### 6.4 IPC & Preload

- Preload exposes a small API via `contextBridge` only: `getServerConfig()`, `onFsEvent()`, optional dialogs.
- Renderer never imports Electron; payloads are structured-clone-safe.
- IPC push events for file watcher changes and window controls.

### 6.5 Workspace & File Watching

- User selects workspace folder on first run; persisted in app storage.
- Chokidar watch on workspace; emits events via IPC to refresh UI tree and invalidate caches.

### 6.6 Security

- Window created with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Hono server binds to `127.0.0.1`/`::1`, random port, bearer token required; reject missing/invalid auth.
- Optional host and origin allowlist to prevent DNS rebinding.
- All file/system tool inputs validated (path normalization, deny traversal, command allow/deny list optional).
- No raw `ipcRenderer` exposed; no sync IPC.

### 6.7 Reliability & Resilience

- SSE endpoint supports reconnection with last-event-id (if using ID’d events) or replays from server memory buffer (minimal acceptable: fresh request).
- Abort handling cleans up child processes.
- Dev hot-reload safety: remove existing IPC handlers before re-registering.

### 6.8 UX Requirements

- Chat layout with conversation list (threads), main message stream, input composer.
- Status indicators: streaming, waiting approval, running tool, stopped, error.
- Tool output pane showing streaming logs with copy/save.
- Diff preview for write/applyPatch before apply (if available from agent plan) and after apply show summary of changed files.
- Settings modal: model selection, temperature, max tokens, workspace path, telemetry toggle.

## 7. Non-Functional Requirements

- **Performance**: UI renders first meaningful paint <2s; chat send-to-first-token <1s on good network; log streaming chunk interval <500ms.
- **Offline**: App launches and basic UI works offline; agent requires LLM connectivity unless local model configured.
- **Observability**: Structured logs for tools (jsonl), agent events (start/stop/error), and approvals (who, what, result). Stored locally with rotation.
- **Accessibility**: Keyboard shortcuts for send/stop, focus management, high-contrast theme.

## 8. Architecture

- **Main Process**: Starts Hono server (loopback, random port, token); hosts Mastra runtime, tools, file watcher; manages window lifecycle.
- **Renderer (SolidJS)**: UI only; uses TanStack AI `useChat` with `fetchServerSentEvents` pointing to `/api/chat` with auth header from preload.
- **Preload**: `contextBridge` exposing minimal API; no raw IPC.
- **SSE Bridge**: `/api/chat` maps Mastra stream events → TanStack StreamChunks; uses Hono `streamSSE` and respects AbortSignal.
- **Memory Engine**: either stdio Python (Chroma + fast-embed) or libSQL in Node; accessed via Mastra tool.
- **Data Flow**: User input → renderer → `/api/chat` → Mastra agent → tools → stream events → TanStack chunks → UI.

## 9. Data Model (v1)

- **Messages**: { id, role, content, timestamp, threadId }
- **ToolCall**: { id, type, payload, requiresApproval, status, timestamps }
- **Memory**: { id, type, topic, title, content, confidence, tags[], scope, projectId?, created_at, last_used_at, deprecated }
- **Workspace**: { path, lastOpenedAt }

## 10. API Contracts (internal)

- `POST /api/chat` (auth required): body { messages, threadId?, resourceId? }; SSE response with TanStack chunks.
- `GET /system/status`: returns { version, uptime, workspacePath }.
- (Optional) `POST /api/approval/:id`: approve/deny tool call.

## 11. Tooling Specifications

- **Filesystem Tool**: structured responses { ok, data?, error?, changedFiles?, diff? }.
- **Shell Tool**: { exitCode, stdout, stderr, durationMs }; stream progress via `writer`.
- **Git Tool**: { status, staged, unstaged, branch, ahead/behind }.
- All tools enforce workspace root and reject disallowed ops.

## 12. Risks & Mitigations

- **LLM drift/unsafe actions**: enforce approvals, schema validation, and deterministic tool envelopes.
- **Context rot**: use Mastra processors (ToolCallFilter, TokenLimiter); encourage retrieval from memory store rather than long logs.
- **SSE disconnects**: implement reconnect/backoff; show UI banner and allow retry.
- **Performance on large outputs**: stream logs incrementally; cap buffer sizes; paginate history.
- **Security regressions**: automated checks for path traversal; CSP and no remote content in renderer.

## 13. Milestones (suggested)

1. Bootstrap Electron window + preload + Solid shell (context isolation verified).
2. Hono server with auth + `/api/chat` mock streaming.
3. Mastra agent + SSE protocol bridge (mapping events to TanStack chunks).
4. Tools (fs, shell, git) with workspace sandboxing + approvals.
5. Memory backend v1 (pick stdio Chroma or libSQL) + `recall_best_practices` tool.
6. UI polish: logs pane, approvals UI, diff preview, settings.
7. Reliability: cancellation, reconnection, file watcher integration, observability.

## 14. Definition of Done (v1)

- App runs with secure defaults; renderer has no Node access.
- `/api/chat` streams TanStack chunks from Mastra; UI renders streaming and stop works.
- Tool approval flow operational; declined calls halt execution.
- Tools sandboxed to workspace; attempts outside are rejected and reported.
- Memory tool retrieves scoped best practices; confidence/filtering works.
- File watcher events appear in UI.
- Basic settings saved; telemetry opt-in only.
- Local logs available for debugging (jsonl with rotation).

## 15. Appendix: References Used

- IPC best practices: minimal preload API, invoke/handle, structured clone payloads.
- Hono SSE bridge: Mastra `.stream()` → TanStack StreamChunks mapping (text-delta→content, tool-call→tool_call, tool-result→tool_result, tool-call-approval→approval-requested, finish→done, errors→error).
- Memory options: stdio (Python + Chroma + fast-embed) vs libSQL schema with embeddings in Node.
- Security: loopback-only server, random port, bearer token, host/origin checks, CSP, no remote content, sandboxed renderer.
