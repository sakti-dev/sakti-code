## Why

The main `agent-loop` spec already mandates automatic compaction: *"The agent SHALL check after each LLM response whether the context window is near capacity (using `shouldCompact`). If so, the agent SHALL summarize old messages via an LLM call, then call `store.replaceMessages()."* This requirement is **unimplemented** — the committed `prompt()` loop has no turn-level compaction check (verified: `git show HEAD:packages/agent/src/loop/index.ts`). Today compaction only works via the manual `POST /api/sessions/:id/compact` route, which the user must trigger explicitly. Long-running sessions silently balloon toward the context window limit and eventually fail with an overflow error the loop has no recovery path for.

The in-progress `agent-loop-controls` change plumbs an `auto_compaction` per-session toggle (`session:{id}:auto_compaction`, default `false`) with nothing behind it — a gate with no door. This change builds the door.

## What Changes

- **Implement turn-level auto-compaction in `prompt()`** — at the top of each turn (before sending to the LLM), estimate token usage; if `shouldCompact(tokens, contextWindow, reserveTokens)` trips and `autoCompaction` is enabled, call the existing `compactMessages()` utility, replace the in-loop message list and `store.replaceMessages()`, and emit `compaction_start` / `compaction_end` events.
- **Gate on `autoCompaction` (default `off`)** — the loop only auto-compacts when `AgentConfig.autoCompaction === true`. The default is `off` (matching the `agent-loop-controls` setting default and avoiding surprise summarization of conversations). Manual compaction via `POST /api/sessions/:id/compact` continues to work regardless of this setting.
- **Plumb an `apiKey` into `AgentConfig`** — `compactMessages()` needs a provider API key to make the summarization LLM call. The agent package is pure (no env/DB access), so `runPrompt` resolves the key via the existing `getEnvApiKey(provider)` pattern (same as the manual `/compact` route) and passes it through `createAgentLoop` → `AgentConfig.apiKey`. When `autoCompaction` is on but no key is configured, the loop **skips compaction gracefully** (it must not die mid-loop for a missing key) — the next turn simply re-evaluates.
- **Wire `runPrompt`** — pass `autoCompaction` (from the per-session setting) and `apiKey` (resolved from the project's model config provider) into `createAgentLoop`.

### No Breaking Changes

`AgentConfig` gains optional `apiKey` and `autoCompaction` fields. All existing consumers (runner, manual `/compact` route, tests) continue to work. Auto-compaction defaults to off, so existing sessions behave identically until the setting is enabled.

## Capabilities

### New Capabilities

_(None.)_

### Modified Capabilities

- `agent-loop`: The existing "Agent loop supports compaction" requirement is currently a lie — the check does not run. This change makes it real: the check runs at the top of each turn, gated by the `autoCompaction` config flag (default off), emits `compaction_start`/`compaction_end` events, and resolves the summarization API key. Adds a requirement describing the `auto_compaction` gate and the graceful-skip-on-missing-key behavior.

## Impact

- **`packages/agent`** — `types.ts` gains `apiKey?: string` and `autoCompaction?: boolean` on `AgentConfig`/`AgentConfigInput`; `loop/index.ts` gains the compaction check at the top of the turn loop (reusing `compactMessages`, `shouldCompact`, `estimateTokens` from `compaction.ts`).
- **`apps/server`** — `runner.ts` resolves the provider API key via `getEnvApiKey` and passes `apiKey` + `autoCompaction` to `createAgentLoop`.
- **Tests** — new agent-package tests for: auto-compaction triggers and replaces messages (mock `completeSimple`); disabled by default (no events); graceful skip when `apiKey` absent; existing 54+ agent tests remain green.
- **Dependencies** — none new. Reuses `@earendil-works/pi-ai` (`getEnvApiKey`, `completeSimple` already used by the manual route).
