# sakti-code API Guide

> Source of truth for the server REST API and WebSocket protocol. Use this while building the frontend.

## Quick reference

| What | Where |
|------|-------|
| Server base URL | `http://localhost:3001` |
| REST prefix | `/api` |
| WebSocket | `ws://localhost:3001/ws` |
| Hono RPC client | `apps/desktop/src/lib/api.ts` (`hcWithType<App>`) |
| WS frame types | `@sakti-code/server/ws` (Task 1 of state plan) |
| Agent event types | `@sakti-code/agent` (`AgentHarnessEvent`, `AgentMessage`) |

---

## Starting the server

```bash
bun dev:server                    # port 3001
SAKTI_PORT=4000 bun dev:server    # custom port
```

The server creates `sakti-code.db` (SQLite) in the working directory. Override with `SAKTI_DB_PATH`.

---

## 1. Projects

A project maps to a codebase directory. Sessions live under projects.

### `Project` shape

```typescript
{
  id: string;          // UUID
  name: string;        // human label
  cwd: string;         // absolute path to codebase
  createdAt: number;   // unix ms
  updatedAt: number;   // unix ms
}
```

### Endpoints

| Method | Path | Body / Query | Response |
|--------|------|-------------|----------|
| GET | `/api/projects` | — | `Project[]` |
| GET | `/api/projects/:id` | — | `Project` or 404 |
| POST | `/api/projects` | `{ name: string, cwd: string }` | `Project` |
| PUT | `/api/projects/:id` | `Partial<{ name, cwd }>` | `Project` |
| DELETE | `/api/projects/:id` | — | — |

### Eden client usage

```typescript
import { api } from "./lib/api";

// List
const { data } = await api.projects.get();

// Create
const { data } = await api.projects.post({ body: { name: "my app", cwd: "/home/user/myapp" } });

// Update
const { data } = await api.projects({ id: "p1" }).put({ body: { name: "renamed" } });
```

---

## 2. Sessions

A session is a conversation thread within a project. Messages are persisted in an entry tree (supports forking and branching).

### `Session` shape

```typescript
{
  id: string;
  projectId: string;
  title: string | null;
  modelId: string;          // e.g. "gpt-4o", "claude-sonnet-4-20250514"
  thinkingLevel: string;    // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
  createdAt: number;        // unix ms
  updatedAt: number;        // unix ms
}
```

### Endpoints

| Method | Path | Body / Query | Response |
|--------|------|-------------|----------|
| GET | `/api/sessions` | `?projectId=<id>` | `Session[]` |
| GET | `/api/sessions/:id` | — | `Session` or 404 |
| POST | `/api/sessions` | `{ projectId, modelId, title? }` | `Session` |
| PATCH | `/api/sessions/:id` | `Partial<{ title, modelId, thinkingLevel }>` | `Session` |
| GET | `/api/sessions/:id/messages` | — | `AgentMessage[]` |

### Messages (`GET /api/sessions/:id/messages`)

Returns the projected message list for the session's current path (root to leaf). This is the conversation history after compaction — may include `compactionSummary` messages that summarize earlier context.

The `AgentMessage` union (import from `@sakti-code/agent`):

```typescript
type AgentMessage =
  | Message                    // user / assistant / tool (from pi-ai)
  | CustomMessage              // extensible app-specific
  | BashExecutionMessage       // bash tool execution record
  | BranchSummaryMessage       // summary of a forked branch
  | CompactionSummaryMessage;  // summary of compacted context
```

For UI rendering, the key fields on a `Message`:

```typescript
{
  role: "user" | "assistant" | "tool";
  content: string | Array<TextContent | ImageContent | ThinkingContent | ToolCallContent>;
  timestamp: number;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
}
```

### Eden client usage

```typescript
// List sessions for a project
const { data } = await api.sessions.get({ query: { projectId: "p1" } });

// Create a session
const { data } = await api.sessions.post({
  body: { projectId: "p1", modelId: "gpt-4o" }
});

// Load message history
const { data } = await api.sessions({ id: "s1" }).messages.get();
```

---

## 3. Session stats

Fast local read — no LLM calls. Derives token counts and cost from assistant `usage` fields.

### `GET /api/sessions/:id/stats`

```typescript
// Response
{
  activeMessageCount: number;   // messages after compaction (not lifetime total)
  totalInputTokens: number;     // summed from assistant usage
  totalOutputTokens: number;
  totalCostUsd: number;         // summed cost.total
  createdAt: number;            // session.createdAt (unix ms)
  durationMs: number;           // Date.now() - session.createdAt
}
```

Returns 404 if session not found.

---

## 4. Session settings

Per-session overrides for agent behavior. Stored as key-value pairs with defaults.

### `GET /api/sessions/:id/settings`

```typescript
// Response (with defaults)
{
  auto_compaction: boolean;     // default: false
  auto_retry: boolean;          // default: true
  follow_up_mode: string;       // default: "all"
  max_retries: number;          // default: 3
  steering_mode: string;        // default: "all"
  thinking_level: string;       // default: "off"
}
```

### `PATCH /api/sessions/:id/settings`

```typescript
// Body — all fields optional
{
  auto_compaction?: boolean;
  auto_retry?: boolean;
  follow_up_mode?: string;
  max_retries?: number;
  steering_mode?: string;
  thinking_level?: string;
}
// Returns 204 No Content
```

---

## 5. Model configuration

Model config (provider + modelId) lives in the DB. Settable per-project or as a global default.

### Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/models/config` | — | `ModelConfig \| null` (global default) |
| GET | `/api/models/config/:projectId` | — | `ModelConfig \| null` |
| POST | `/api/models/config` | `{ provider, modelId, thinkingLevel?, projectId? }` | — |

### `ModelConfig` shape

```typescript
{
  id: string;
  projectId: string | null;   // null = global default
  provider: string;           // "openai" | "anthropic" | "google" | ...
  modelId: string;            // "gpt-4o", "claude-sonnet-4-20250514", ...
  thinkingLevel: string;
  createdAt: number;
  updatedAt: number;
}
```

Posting with `projectId` sets/updates that project's config (upsert via `onConflictDoUpdate`). Posting without `projectId` sets the global default.

### Available models catalog

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/models/available` | `string[]` (provider names) |
| GET | `/api/models/available/:provider` | `Model[]` |

### API keys

API keys come from **environment variables**, never from the DB:

| Provider | Env var |
|----------|---------|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GOOGLE_API_KEY` |

If no key is set, `sendPrompt` and `compact` return an error.

---

## 6. Forking

Forking copies a session's entry tree to a new session. The new session gets `"Fork of <title>"` (strips existing prefix on re-fork).

### `POST /api/sessions/:id/fork`

```typescript
// Response: Session (the new forked session)
```

On failure, the partially-created session is deleted (route-level catch).

### `GET /api/sessions/:id/fork-messages`

Returns a preview of forkable messages (user + assistant only, text truncated to 200 chars):

```typescript
// Response
Array<{
  role: "user" | "assistant";
  textPreview: string;  // first 200 chars
}>
```

---

## 7. Compaction

Runs the agent's summarizer on a session's entry tree, persists a `CompactionSummaryMessage` entry, and returns the summary. **This makes an LLM call** — latency depends on the provider.

### `POST /api/sessions/:id/compact`

```typescript
// Success response (200)
{
  tokensBefore: number;       // token count before compaction
  summary: string;            // the generated summary
  firstKeptEntryId: string;   // first entry kept after compaction
}

// Skipped (200) — nothing to compact
{
  tokensBefore: 0;
  tokensAfter: 0;
  skipped: true;
}

// Error (500) — no model config, no API key, or summarization failure
```

---

## 8. Export

### `GET /api/sessions/:id/export-html`

Returns a standalone HTML document (`Content-Type: text/html`) rendering the session's messages with basic styling. Used for sharing or archiving.

---

## 9. Last assistant text

### `GET /api/sessions/:id/last-assistant-text`

```typescript
// Response
{ text: string | null }
```

Scans the session's messages from the end, returns the text content of the last assistant message.

---

## 10. Git operations

All git routes operate on the project's `cwd`.

| Method | Path | Query | Response |
|--------|------|-------|----------|
| GET | `/api/projects/:id/git/status` | — | `string` (git status --short output) |
| GET | `/api/projects/:id/git/branch` | — | `string` (current branch name) |
| GET | `/api/projects/:id/git/diff` | `?staged=<bool>&path=<string>` | `string` (diff output) |
| GET | `/api/projects/:id/git/log` | `?limit=<int>` | `string` (oneline log, default 20) |
| GET | `/api/projects/:id/git/turn-diff` | `?files=<string[]>` | `{ files, diff, cwd }` |

### Turn-diff response

```typescript
{
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  diff: string;     // full `git diff HEAD` output
  cwd: string;
}
```

Returns `{ files: [], diff: "", cwd }` if there's no HEAD commit yet.

---

## 11. File search

### `GET /api/projects/:id/files`

| Query | Type | Default |
|-------|------|---------|
| `query` | `string?` | — (lists all) |
| `limit` | `number?` | 20 (max 100) |

```typescript
// Response
{
  files: Array<{
    path: string;
    kind: "file" | "directory";
  }>;
  cwd: string;
}
```

Uses `fd` if available, falls back to `find`. Ignores `node_modules`, `.git`, `dist`, `build`, etc.

---

## 12. Global settings

Key-value store for app-level preferences.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/settings` | — | `Record<string, string>` (all keys) |
| GET | `/api/settings/:key` | — | `string` or 404 |
| PUT | `/api/settings/:key` | `{ value: string }` | 204 |

---

## 13. Workspace sessions

Tracks workspace paths for the session picker / dashboard.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/workspace/sessions` | — | `string[]` (paths) |
| POST | `/api/workspace/sessions` | `{ sessionPath: string }` | `string[]` |
| DELETE | `/api/workspace/sessions/:path` | — | `string[]` |

---

## 14. Health

### `GET /health`

```typescript
{ status: "ok", uptime: number }
```

Note: no `/api` prefix — this is at the root level.

---

## 15. WebSocket protocol

The single `/ws` endpoint handles all agent streaming and terminal I/O.

### Connection lifecycle

1. Client opens `ws://localhost:3001/ws`
2. Server immediately sends a **welcome frame**:

```typescript
{
  type: "welcome";
  version: string;    // server package version
  cwd: string;        // server working directory
}
```

3. Client sends **input frames** (prompts, aborts, steering)
4. Server sends **output frames** (events, errors, terminal pushes)
5. On disconnect, server cleans up session storage and closes terminals for that connection

### Client → Server frames (`WsIn`)

Import type: `import type { WsIn } from "@sakti-code/server/ws"`

```typescript
type WsIn =
  | { type: "prompt"; sessionId: string; message: string }
  | { type: "abort"; sessionId: string }
  | { type: "steer"; sessionId: string; message: string }
  | { type: "followUp"; sessionId: string; message: string };
```

| Frame | When | Behavior |
|-------|------|----------|
| `prompt` | User sends a new message | Starts a full agent run. Returns error if a run is already active. |
| `abort` | User clicks stop | Aborts the active run. No-op if no run active. |
| `steer` | User injects mid-run guidance | Queues a steering message processed during the active run. |
| `followUp` | User queues a next-turn message | Queues a message for after the current run finishes. |

**Single active run per session.** Multiple sessions can run concurrently on the same WS connection.

### Server → Client frames (`WsOut`)

Import type: `import type { WsOut } from "@sakti-code/server/ws"`

```typescript
type WsOut =
  | WelcomeFrame
  | EventFrame
  | ErrorFrame
  | PushFrame;
```

#### WelcomeFrame

```typescript
{ type: "welcome"; version: string; cwd: string }
```

Sent once on connection open.

#### EventFrame

```typescript
{ type: "event"; sessionId: string; event: AgentHarnessEvent }
```

The core streaming frame. `event` is an `AgentHarnessEvent` from `@sakti-code/agent`. See the event reference below.

#### ErrorFrame

```typescript
{ type: "error"; sessionId: string; error: string }
```

Sent when a run fails, abort fails, steer/followUp fails, or the prompt is missing fields.

#### PushFrame

```typescript
{
  type: "push";
  channel: "terminal.data" | "terminal.exit";
  data:
    | { terminalId: string; data: string }                          // terminal.data
    | { terminalId: string; exitCode: number; signal?: number | string }; // terminal.exit
}
```

Terminal output and exit events for interactive terminals.

---

## 16. AgentHarnessEvent reference

Import: `import type { AgentHarnessEvent } from "@sakti-code/agent"`

These are the events the UI receives inside `EventFrame.event`. They come in two families: **agent lifecycle** (`AgentEvent`) and **harness lifecycle** (`AgentHarnessOwnEvent`).

### Agent lifecycle events (high-frequency, streaming)

These are the events you handle for the chat view:

#### `agent_start`

```typescript
{ type: "agent_start" }
```
The agent run has started. Set phase to "thinking".

#### `agent_end`

```typescript
{ type: "agent_end"; messages: AgentMessage[] }
```
The agent run completed. `messages` contains the full conversation. Set phase to "idle". Refresh stats from REST.

#### `turn_start`

```typescript
{ type: "turn_start" }
```
A new turn is starting (one assistant response + tool calls). Set phase to "thinking".

#### `turn_end`

```typescript
{ type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
```
A turn finished. The assistant message is complete.

#### `message_start`

```typescript
{ type: "message_start"; message: AgentMessage }
```
A new message is being constructed. For `role: "assistant"`, create a placeholder UIMessage and mark it streaming. For `role: "user"`, skip (already inserted optimistically).

#### `message_update`

```typescript
{
  type: "message_update";
  message: AgentMessage;                      // full accumulated message
  assistantMessageEvent: AssistantMessageEvent; // streaming delta
}
```

The streaming token event. `assistantMessageEvent` contains the incremental delta:

```typescript
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

For UI token batching, handle `text_delta` by accumulating `delta` via the token batcher.

#### `message_end`

```typescript
{ type: "message_end"; message: AgentMessage }
```
Message construction complete. Mark the UIMessage as done.

#### `tool_execution_start`

```typescript
{ type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
```
A tool (bash, read, edit, grep, etc.) started executing. Add a tool_call part to the current assistant message, set phase to "tool_running".

#### `tool_execution_update`

```typescript
{ type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
```
Partial result from a running tool (e.g. incremental bash output). Update the tool_call part.

#### `tool_execution_end`

```typescript
{ type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
```
Tool finished. Mark the tool_call part as done/error with the result.

### Harness lifecycle events (low-frequency, structural)

These are mostly for status displays and internal state:

| Event type | Payload highlight | UI use |
|------------|-------------------|--------|
| `before_agent_start` | `{ prompt, systemPrompt, resources }` | Debug / status |
| `context` | `{ messages: AgentMessage[] }` | Debug |
| `before_provider_request` | `{ model, sessionId, streamOptions }` | Debug |
| `before_provider_payload` | `{ model, payload }` | Debug |
| `after_provider_response` | `{ headers, status }` | Debug / error detection |
| `tool_call` | `{ toolCallId, toolName, input }` | Hook-level (precedes `tool_execution_start`) |
| `tool_result` | `{ toolCallId, toolName, content, isError }` | Hook-level (precedes `tool_execution_end`) |
| `queue_update` | `{ followUp, nextTurn, steer }` | Show queued messages |
| `save_point` | `{ hadPendingMutations }` | Internal |
| `abort` | `{ clearedFollowUp, clearedSteer }` | Confirm abort |
| `settled` | `{ nextTurnCount }` | Run fully settled |
| `session_before_compact` | `{ preparation }` | Pre-compaction |
| `session_compact` | `{ compactionEntry }` | Post-compaction |
| `session_before_tree` | `{ preparation }` | Pre-branch summary |
| `session_tree` | `{ oldLeafId, newLeafId }` | Branch navigation |
| `model_update` | `{ model, previousModel, source }` | Model changed |
| `thinking_level_update` | `{ level, previousLevel }` | Thinking level changed |
| `tools_update` | `{ toolNames, activeToolNames }` | Active tools changed |
| `resources_update` | `{ resources }` | Skills/prompts changed |

For the initial frontend, focus on the **agent lifecycle** events (agent_start through agent_end). The harness events can be handled later for richer UI.

---

## 17. Terminals (REST + WS push)

Interactive terminals require a live WS connection — data flows over WS pushes, control goes through REST.

### Create terminal

**`POST /api/workspace/terminals`**

```typescript
// Body
{
  connectionId: string;   // from the WS welcome frame's wsId
  cwd?: string;           // default: server cwd
  cols?: number;          // default: 80
  rows?: number;          // default: 24
}

// Response (200)
{
  terminalId: string;
  pid: number;
}
```

Returns 400 if `connectionId` has no open WS, 503 if `bun-pty` is not available.

### Write to terminal

**`POST /api/workspace/terminals/:id/write`**

```typescript
// Body
{ data: string }
// Returns 200 "OK" or 404
```

### Resize terminal

**`POST /api/workspace/terminals/:id/resize`**

```typescript
// Body
{ cols: number, rows: number }
// Returns 200 "OK" or 404
```

### Close terminal

**`DELETE /api/workspace/terminals/:id`**

Returns 200 "OK" or 404.

### Terminal data over WS

Once a terminal is created, the server pushes terminal output over the same WS connection:

```typescript
// Data (stdout/stderr from the terminal process)
{
  type: "push";
  channel: "terminal.data";
  data: { terminalId: string; data: string }
}

// Exit
{
  type: "push";
  channel: "terminal.exit";
  data: { terminalId: string; exitCode: number; signal?: number | string }
}
```

The frontend should accumulate `terminal.data` into a per-terminal buffer and render it in a terminal emulator component.

---

## 18. End-to-end flow: sending a prompt

Here's the complete lifecycle when a user types a message and hits send:

```
1. Frontend: createSession (if needed)
   POST /api/sessions { projectId, modelId }
   → { id: "s1", ... }

2. Frontend: set model config (if needed)
   POST /api/models/config { provider: "openai", modelId: "gpt-4o", projectId: "p1" }

3. Frontend: open WS (if not open)
   ws://localhost:3001/ws
   ← { type: "welcome", version: "...", cwd: "..." }

4. Frontend: send prompt
   → { type: "prompt", sessionId: "s1", message: "fix the bug in auth.ts" }

5. Server: resolves model + API key from env
   Server: builds tools (bash, read, edit, grep, find, ls, write)
   Server: creates AgentHarness and calls harness.prompt(message)

6. Server streams events back:
   ← { type: "event", sessionId: "s1", event: { type: "agent_start" } }
   ← { type: "event", sessionId: "s1", event: { type: "turn_start" } }
   ← { type: "event", sessionId: "s1", event: { type: "message_start", message: { role: "assistant", content: "", ... } } }
   ← { type: "event", sessionId: "s1", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "I'll", ... } } }
   ← { type: "event", sessionId: "s1", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " help", ... } } }
   ...
   ← { type: "event", sessionId: "s1", event: { type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "...", name: "bash", arguments: { command: "cat auth.ts" } } } }
   ← { type: "event", sessionId: "s1", event: { type: "tool_execution_start", toolCallId: "...", toolName: "bash", args: { command: "cat auth.ts" } } }
   ← { type: "event", sessionId: "s1", event: { type: "tool_execution_end", toolCallId: "...", toolName: "bash", result: { content: [{ type: "text", text: "..." }] }, isError: false } }
   ← { type: "event", sessionId: "s1", event: { type: "message_end", message: { role: "assistant", content: "...", ... } } }
   ← { type: "event", sessionId: "s1", event: { type: "turn_end", message: { ... }, toolResults: [ ... ] } }
   ← { type: "event", sessionId: "s1", event: { type: "agent_end", messages: [ ... ] } }

7. Frontend: refresh stats (optional)
   GET /api/sessions/s1/stats
   → { activeMessageCount: 4, totalInputTokens: 1200, totalOutputTokens: 800, ... }
```

---

## 19. Abort flow

```
→ { type: "abort", sessionId: "s1" }
← { type: "event", sessionId: "s1", event: { type: "abort", clearedFollowUp: [...], clearedSteer: [...] } }
← { type: "event", sessionId: "s1", event: { type: "agent_end", messages: [...] } }
```

The agent run stops after the current tool batch settles. `agent_end` is still sent.

---

## 20. Steer and follow-up

### Steer (mid-run injection)

```
→ { type: "steer", sessionId: "s1", message: "also check the test file" }
```

The steering message is queued. On the next turn boundary, the harness prepends it to the context. No immediate acknowledgment — the effect is visible in subsequent `message_update` events.

### Follow-up (post-run queue)

```
→ { type: "followUp", sessionId: "s1", message: "now add tests for the fix" }
```

Queued for after the current run finishes. When the current `agent_end` fires, the follow-up triggers a new run automatically.

### Queue visibility

```
← { type: "event", sessionId: "s1", event: { type: "queue_update", followUp: [...], nextTurn: [...], steer: [...] } }
```

Shows what's queued. Use this to render a "queued messages" indicator in the UI.

---

## Type import cheat sheet

```typescript
// REST types (via Eden treaty — automatic from App type)
import type { App } from "@sakti-code/server";

// WS frame types
import type { WsIn, WsOut } from "@sakti-code/server/ws";

// Agent event + message types
import type {
  AgentHarnessEvent,
  AgentMessage,
  AgentEvent,
} from "@sakti-code/agent";

// Pi-ai streaming types (transitive via agent)
import type {
  AssistantMessageEvent,
  Message,
  TextContent,
  ImageContent,
  AssistantMessage,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai/base";
```
