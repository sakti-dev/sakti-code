## Context

The agent loop in `packages/agent` is a self-contained async generator (`createAgentLoop(config).prompt(message, signal)`) that streams `AgentEvent`s. It currently has no mid-stream control surface — once a prompt starts, the caller cannot intervene until the loop terminates.

Three concrete gaps exist:

1. **Thinking level is stored but dead** — `sessions.thinkingLevel` and `modelConfigs.thinkingLevel` are persisted to the DB but never read at loop construction time. `streamSimple()` accepts a `thinkingLevel` parameter in pi-ai, but `streamLLMResponse` never passes it.

2. **No mid-stream steering** — pibun supports `session.steer` (inject guidance during tool execution) and `session.followUp` (queue a message for after the current turn). Our loop has no equivalent.

3. **Per-session settings don't reach the loop** — `maxRetries`, auto-compaction behavior, and retry delays are global defaults in `createAgentConfig`. There's no mechanism for per-session overrides.

The existing `settings` table (key-value) provides a natural storage for per-session runtime settings using a `session:{id}:{key}` key convention. No schema migration is needed.

Verified facts:
- `streamSimple(model, { messages, tools }, { apiKey, signal, thinkingLevel?, maxTokens? })` — accepts optional `thinkingLevel` per pi-ai docs
- `createAgentConfig(input: AgentConfigInput)` → `AgentConfig` — `maxRetries` and `retryBaseDelayMs` have defaults but no per-session loading
- `loop/index.ts` `prompt()` — the single generator function that orchestrates LLM streaming, tool execution, and turn management
- `SqliteSessionStore(db)` — wraps `MessageRepo`, knows sessionId; could gain a `loadSettings(sessionId)` helper

## Goals / Non-Goals

**Goals:**
- Thread `thinkingLevel` from the session's config through `streamLLMResponse` → `streamSimple`
- Add `steer(message)` and `followUp(message)` to the `AgentLoop` interface
- Implement a simple steer/follow-up queue in the loop — FIFO, bounded at 10 messages
- On steer mid-tool-execution: abort the current tool, inject steer message, re-send to LLM
- On follow-up: queue message, send after current turn completes
- Add per-session settings loading at loop construction (auto-compaction toggle, maxRetries override, auto-retry toggle)
- Expose settings via `GET/PATCH /api/sessions/:id/settings`
- Expose steer/follow-up via `POST /api/sessions/:id/steer` and `POST /api/sessions/:id/follow-up`
- Expand WS protocol with `steer` and `followUp` inbound message types
- Route composition — no `apps/server/src/index.ts` edits

**Non-Goals:**
- Interactive terminals — separate change
- User bash (independent of the agent loop) — separate change
- Session forking — separate change
- Multi-modal steer (images, files) — v2 of this feature
- Per-message priority steer — FIFO is sufficient for v1
- Settings persistence across server restarts — already handled by the `settings` table

## Decisions

### 1. Steer/follow-up queue model (FIFO, bounded at 10)

**Decision:** The `AgentLoop` interface gains `steer(message: string)` and `followUp(message: string)` methods. Each writes to a `steerQueue: string[]` or `followUpQueue: string[]` on the loop instance. The `prompt()` generator reads these queues at two decision points:

```
prompt() flow with steer/follow-up:
═══════════════════════════════════════════

  agent_start
       │
       ▼
  ┌────────────────────┐
  │  Check steerQueue   │ ← First, process queued steers
  │  If non-empty:      │
  │    → pop first      │
  │    → inject as user │
  │      message        │
  └────────┬───────────┘
           ▼
  turn_start → message_start → streamLLM → message_end
       │                                       │
       │                            ┌───────────┘
       │                            ▼
       │                   ┌────────────────────┐
       │                   │  Any tool calls?    │
       │                   └──────┬─────────────┘
       │                     Yes  │         No
       │                          ▼          ▼
       │              execute tools    ┌──────────────┐
       │                  │           │ Check follow- │
       │                  │           │ UpQueue       │
       │                  ▼           │ If non-empty: │
       │           ┌──────────────┐    │  → inject     │
       │           │ Check steer- │    │  → continue   │
       │           │ Queue again  │    │    loop       │
       │           │ (steer mid-  │    └──────┬───────┘
       │           │  tool-exec)  │           │
       │           │ If non-empty:│     Empty │
       │           │  → abort     │           ▼
       │           │    current   │       turn_end
       │           │    tool      │       agent_end
       │           │  → inject    │
       │           │    steer msg │
       │           └──────┬───────┘
       │                  │
       └──────────────────┘
```

**Alternative considered:** EventEmitter pattern where the loop subscribes to external steer events. **Rejected:** a queue on the loop instance is simpler, testable, and doesn't require wiring external event buses through the runner.

### 2. Tool abortion on steer during execution

**Decision:** When a steer message arrives while a tool is executing, the current tool is aborted via the tool's `AbortSignal`. The partial tool result (whatever was accumulated) is still appended to messages, then the steer message is injected, and the loop re-sends to the LLM.

**Rationale:** Tools (especially bash) can run for many seconds. Waiting for completion defeats the purpose of steering. Aborting the current tool and re-sending with the steer message gives the LLM the chance to re-plan with the new guidance.

**Risk:** Partial tool results could confuse the LLM. **Mitigation:** the tool result is appended with the accumulated output; the LLM is capable of ignoring irrelevant output.

### 3. Thinking level loaded from session config at loop construction

**Decision:** `runPrompt` reads `session.thinkingLevel` from the session row (already populated by the DB). It passes it through `createAgentLoop` → `AgentConfig` → `streamLLMResponse` → `streamSimple` options.

```
Session row                   AgentConfig         streamLLMResponse
┌──────────────┐             ┌────────────┐       ┌───────────────┐
│ thinkingLevel │ ───────►   │ thinking   │ ──►   │ streamSimple  │
│ = "high"      │            │ Level      │       │ ({thinking    │
└──────────────┘             │ = "high"   │       │   Level:      │
                             └────────────┘       │    \"high\"})   │
                                                  └───────────────┘
```

**Alternative considered:** read thinking level from per-session settings at runtime. **Rejected:** the session row already stores `thinkingLevel` as a session-level attribute (set at creation or via `PATCH /api/sessions/:id`). This is the correct source of truth. Per-session settings are for runtime toggles that change more frequently.

### 4. Per-session settings via the existing `settings` table

**Decision:** Use key convention `session:{id}:{setting}` in the `settings` table. The loop loads settings once at construction time.

Settings:
- `session:{id}:auto_compaction` → `"true"`/`"false"` (default: from `AgentConfig.keepRecentTokens` behavior)
- `session:{id}:auto_retry` → `"true"`/`"false"` (default: `"true"`)
- `session:{id}:max_retries` → `"3"` (default: `3`)
- `session:{id}:steering_mode` → `"all"`/`"one-at-a-time"` (default: `"all"`)
- `session:{id}:follow_up_mode` → `"all"`/`"one-at-a-time"` (default: `"all"`)

**Route:** `GET /api/sessions/:id/settings` returns all settings (merged defaults + overrides). `PATCH /api/sessions/:id/settings` updates individual keys.

**Alternative considered:** new `session_settings` table. **Rejected:** the existing `settings` table is already a key-value store; adding a dedicated table for what amounts to 5 keys is over-engineering. The key convention is simple and discoverable via `SELECT * FROM settings WHERE key LIKE 'session:{id}:%'`.

### 5. WS protocol extension

**Decision:** Add two new inbound message types alongside existing `prompt` and `abort`:

```typescript
// Inbound
{ type: "steer", sessionId: string, message: string }
{ type: "followUp", sessionId: string, message: string }

// Outbound — no new types (steer/follow-up produce existing AgentEvents)
// The loop yields text_delta, tool_execution, etc. as it processes
// the injected steer/follow-up message
```

The WS handler looks up the active loop for the given `sessionId` (via the `activeRuns` map) and calls `loop.steer(message)` or `loop.followUp(message)` directly. If no active run exists, it returns an `error` frame.

**Alternative considered:** treat steer/follow-up as REST endpoints. **Rejected:** steer/follow-up are mid-stream operations; the WS connection is where the stream is happening. Calling a REST endpoint would require the server to somehow find the active WS loop and inject messages — fragile.

### 6. No new SessionStore methods for v1

**Decision:** The loop reads settings directly from the `SettingsRepo` (available via `ServerContext`) rather than adding a `loadSettings` method to the `SessionStore` interface. The `SessionStore` interface stays unchanged.

**Rationale:** Settings are a server-layer concern (which key-value store, which convention). The `SessionStore` interface lives in `packages/agent` and should stay focused on message persistence. Adding settings to it would couple the agent package to a specific settings storage model.

## Risks / Trade-offs

- **[Steer during tool execution aborts the tool]** the tool's partial output may be useless or confusing to the LLM. → **Accepted:** the alternative (waiting for tool completion) defeats the purpose of steering. The LLM handles partial output well in practice.
- **[FIFO queue overflow]** a fast client could queue 10+ steer messages before the loop processes them. → **Mitigation:** bounded queue at 10; overflow messages are silently dropped (the client should wait for ack before sending the next steer).
- **[Steer/follow-up on a completed loop]** if the loop has finished (agent_end already sent), steer/follow-up returns an error frame. → **Expected:** the client should check if the session is still active before sending steer/follow-up.
- **[Per-session settings loaded once at construction]** a settings change won't take effect until the next prompt. → **Accepted:** settings are not expected to change mid-stream. If a user changes auto-retry while a prompt is running, the next prompt picks it up.
- **[Route composition]** the new routes follow the existing pattern — no `index.ts` edits. The WS handler is extended (not replaced). The test composition pattern (`buildServer` with `routes` array) is already established.

## Open Questions

- Should steer messages be persisted to the session history? **Decision: yes** — they become user messages in the message list, so the conversation is self-documenting. The client can display them as "steer" messages.
- Should followUp messages be persisted immediately or only if the loop runs them? **Decision: persisted immediately** — the user sent a message; it should appear in the history even if the loop terminates before processing it.
- Should settings have a bulk-load method on `SettingsRepo`? **Decision: yes** — add `getByPrefix(prefix: string)` to `SettingsRepo` so the loop can load all `session:{id}:*` keys in one query.
