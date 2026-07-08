## Why

The sakti-code agent loop currently operates as a fire-and-forget loop with no user controls during execution. The schema already stores `thinkingLevel` on sessions and `modelConfigs`, but it's dead data — never passed to the LLM. Users have no way to guide the agent mid-stream, adjust its thinking depth, or configure per-session behavior like auto-compaction or retry thresholds. This creates a frustrating experience: once a prompt is sent, the user is locked out until the entire turn completes.

Meanwhile, pibun's WebSocket protocol supports `session.steer`, `session.followUp`, `session.setThinking`, `session.setAutoCompaction`, and `session.setAutoRetry` — all controls that let users interact with an active session. Without these, sakti-code feels like a read-only viewer rather than a collaborative coding tool.

## What Changes

### Additions

- **Thread `thinkingLevel` through the streaming pipeline** — read from the session's config row, pass it to `streamSimple`, so the LLM receives the user's preferred reasoning depth
- **Add `steer(message)` to the AgentLoop interface** — inject a user message mid-stream during an active turn; the loop interrupts tool execution, sends the steer message, and continues the turn
- **Add `followUp(message)` to the AgentLoop interface** — queue a follow-up message that's sent after the current turn completes, before the loop checks for termination
- **Expose per-session runtime settings** — new DB settings keys (`auto_compaction`, `auto_retry`, `steering_mode`, `follow_up_mode`, `thinking_level`) read at loop construction time
- **Add `maxRetries` to per-session config** — currently a global default in `createAgentConfig`; expose it as a per-session override
- **Add server routes** — `PATCH /api/sessions/:id/settings` for runtime toggles, `POST /api/sessions/:id/steer`, `POST /api/sessions/:id/follow-up`
- **Expand WS protocol** — add `steer`, `followUp` message types alongside existing `prompt` and `abort`

### No Breaking Changes

The `AgentConfigInput` interface gains optional fields. The `AgentLoop` interface gains optional methods. All existing consumers (runner, tests) continue to work without changes.

## Capabilities

### New Capabilities

- **session-controls**: Users can steer and follow up on an active session mid-stream
- **thinking-level-config**: The stored thinking level per session is actually honored by the LLM
- **per-session-settings**: Runtime settings (auto-compaction, auto-retry, steering mode, follow-up mode) are readable and writable per session

### Modified Capabilities

- **agent-streaming**: The WS protocol gains new inbound message types (`steer`, `followUp`). The runner thread uses per-session settings when constructing the loop.
- **agent-loop**: The `AgentLoop` interface gains new methods. The `createAgentConfig` input gains new optional fields.
- **session-store-sqlite**: No schema changes needed (settings use the existing `settings` table keyed by `session:{id}:{key}`), but `SessionStore` may gain a `loadSettings` method for bulk reads.

## Impact

### Packages

- **`packages/agent`** — `types.ts` gains new config fields; `loop/index.ts` gains `steer`/`followUp` methods; `loop/streaming.ts` threads thinking level to LLM
- **`apps/server`** — new WS message types in `ws-handler.ts`; new routes for settings and steer/follow-up; no `index.ts` edits (route composition)
- **`packages/db`** — no schema changes; settings reuse the existing key-value `settings` table

### Tests

- Agent tests (54) must remain green — additions are additive
- New unit tests for steer/follow-up behavior in the loop
- New server tests for settings routes and WS message types
- Mock pi-ai for deterministic streaming tests (existing patterns)

### Risks

- **Steering mid-tool-execution** — if the agent is running a bash command when a steer arrives, we either wait for the tool to finish or abort it. The design should abort the current tool and let the loop re-plan with the steer message included.
- **Concurrent steer/follow-up** — multiple steer messages could arrive before the loop processes them. A queue model (FIFO) with bounded size is the simplest safe approach.
