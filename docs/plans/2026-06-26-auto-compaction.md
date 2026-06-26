# Auto-Compaction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port pi's turn-level auto-compaction so a session's context is summarized before it grows past the model's window — fixing the root cause of the "hi? does nothing" failure (a 192-message context made z.ai return `finishReason:"other"` + empty usage).

**Architecture:** The agent loop is a faithful port of pi's and (correctly) does NOT compact internally — neither does pi's. The compaction **orchestrator** lives in the app layer. We port pi's `_checkCompaction` + `_runAutoCompaction` (from `openspec/references/pi/packages/coding-agent/src/core/agent-session.ts`) + `isContextOverflow` (from `openspec/references/pi/packages/ai/src/utils/overflow.ts`) into the server, hooking them into our turn loop (`executeWithRetry` in `apps/server/src/agent/retry-loop.ts`, which is our `_handlePostAgentRun` equivalent). The pure primitives already exist and mirror pi's (`packages/agent/src/compaction.ts`: `shouldCompact`, `estimateContextTokens`, `calculateContextTokens`, `prepareCompaction`, `compact`). Compaction events (`compaction_start`/`compaction_end`) are added to the `AgentEvent` union and flow to the desktop over the existing generic `EventFrame` channel (desktop safely ignores unknown event types — verified: `dispatchEvent` has no exhaustiveness check, `updateStreamingState` uses non-exhaustive `if`).

**Tech Stack:** TypeScript, vitest, `@sakti-code/agent` (compaction primitives), `@sakti-code/llm` (Model/AssistantMessage types), Hono server.

**Porting discipline:** `[PORT]` = copy from pi reference, adapt to sakti. `[NEW]` = cross-compare, pick best path.

---

## Reference map (pi → sakti)

| Concern | pi location | sakti target |
| :--- | :--- | :--- |
| overflow detection | `packages/ai/src/utils/overflow.ts:126` | `packages/llm/src/context-overflow.ts` `[PORT]` |
| decision (overflow+threshold+zero-usage fallback) | `agent-session.ts:1816 _checkCompaction` | `apps/server/src/agent/auto-compaction.ts checkCompaction` `[PORT]` |
| execution (prepare+compact+persist+emit) | `agent-session.ts:1907 _runAutoCompaction` | `apps/server/src/agent/auto-compaction.ts runAutoCompaction` `[PORT]` |
| turn-loop hook | `agent-session.ts:947 _runAgentPrompt`/`_handlePostAgentRun` | `apps/server/src/agent/retry-loop.ts executeWithRetry` `[NEW]` |
| compaction events | `agent-session.ts:137` (`compaction_start`/`compaction_end`) | `packages/agent/src/types.ts AgentEvent` `[PORT]` |
| one-retry-per-overflow guard | `agent-session.ts:286 _overflowRecoveryAttempted` | local var in the compaction phase `[PORT]` |
| settings | `settings-manager.ts:754` (enabled/reserve/keep, defaults true/16384/20000) | `parseCompactionSettings` from session KV `[PORT]` |

**Key pi behavior to preserve:**
- `isContextOverflow` has 3 cases: (1) error msg matching `OVERFLOW_PATTERNS` and not `NON_OVERFLOW_PATTERNS`; (2) silent z.ai overflow — `stopReason:"stop"` + `input+cacheRead > contextWindow`; (3) MiMo length-stop — `stopReason:"length"` + `output===0` + `input+cacheRead >= contextWindow*0.99`.
- Threshold check falls back to `estimateContextTokens(messages)` when `stopReason==="error"` OR `calculateContextTokens(usage)===0` — **this is the z.ai fix** (empty usage → 0 → fall back to local chars/4 estimate). `lastUsageIndex===null` → bail (no usage data).
- Overflow allows ONE compact-and-retry per episode; `willRetry=false` when `stopReason==="stop"` (silent overflow can't `continue()` from a completed assistant message).
- Compaction calls the **standalone** `compact()` function (NOT `harness.compact()`, which is idle-gated and can't run mid-loop). Persists via `session.appendCompaction()`.
- Stale-usage guard: skip if the assistant message predates the latest compaction entry.

---

### Task 1: Port `isContextOverflow` (pure, with tests)

**Files:**
- Create: `packages/llm/src/context-overflow.ts`
- Test: `packages/llm/src/__tests__/context-overflow.test.ts`
- Modify: `packages/llm/src/index.ts` (export)

**Step 1: Write the failing test** — `[PORT]` the 3 detection cases.

```ts
// packages/llm/src/__tests__/context-overflow.test.ts
import { describe, expect, it } from "vitest";
import { isContextOverflow } from "../context-overflow.ts";
import type { AssistantMessage } from "../types.ts";

const usage = (input: number, output = 1) => ({
  input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function asst(stopReason: AssistantMessage["stopReason"], over: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant", content: [], api: "openai", provider: "p", model: "m",
    usage: usage(10), stopReason, timestamp: 0, ...over,
  } as AssistantMessage;
}

describe("isContextOverflow", () => {
  it("Case 1: error whose message matches an overflow pattern", () => {
    expect(isContextOverflow(asst("error", { errorMessage: "prompt is too long" }))).toBe(true);
    expect(isContextOverflow(asst("error", { errorMessage: "context_length_exceeded" }))).toBe(true);
  });
  it("Case 1: rate-limit errors are NOT overflow even if pattern matches", () => {
    expect(isContextOverflow(asst("error", { errorMessage: "rate limit exceeded" }))).toBe(false);
  });
  it("Case 2: silent z.ai overflow — stop + input > contextWindow", () => {
    expect(isContextOverflow(asst("stop", { usage: usage(2000) }), 1000)).toBe(true);
    expect(isContextOverflow(asst("stop", { usage: usage(500) }), 1000)).toBe(false);
  });
  it("Case 3: MiMo length-stop — length + output 0 + input fills window", () => {
    expect(isContextOverflow(asst("length", { usage: usage(990, 0) }), 1000)).toBe(true);
    expect(isContextOverflow(asst("length", { usage: usage(500, 0) }), 1000)).toBe(false);
  });
  it("returns false for a normal stop within window", () => {
    expect(isContextOverflow(asst("stop", { usage: usage(100) }), 1000)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails** — `cd packages/llm && pnpm run test src/__tests__/context-overflow.test.ts` → FAIL (module not found).

**Step 3: Implement** — `[PORT]` from `openspec/references/pi/packages/ai/src/utils/overflow.ts:35-130`. Copy `OVERFLOW_PATTERNS`, `NON_OVERFLOW_PATTERNS`, `isContextOverflow` verbatim; import our `AssistantMessage`/`Usage` types from `./types.ts`.

**Step 4: Run test to verify it passes.**

**Step 5: Export** from `packages/llm/src/index.ts` and commit.

---

### Task 2: Add compaction events to `AgentEvent`

**Files:**
- Modify: `packages/agent/src/types.ts:563` (the `AgentEvent` union)

**Step 1: Add the two variants** `[PORT]` from `agent-session.ts:137-147`:

```ts
  // Auto-compaction lifecycle — emitted by the SERVER's compaction phase
  // (never by the agent loop). `compaction_start` fires before the summary
  // LLM call; `compaction_end` fires on success/abort/failure.
  | { type: "compaction_start"; reason: "threshold" | "overflow" }
  | {
      type: "compaction_end";
      reason: "threshold" | "overflow";
      // Undefined when the run aborted or failed before producing a summary.
      result?: { summary: string; firstKeptEntryId: string; tokensBefore: number };
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
```

(`CompactionResult` is not re-used directly to keep `packages/agent` free of pulling the full type into the wire event; the inline shape matches what the UI needs.)

**Step 2: typecheck** — `pnpm run typecheck`. The desktop `dispatchEvent`/`updateStreamingState` are non-exhaustive (verified) so they ignore the new types.

**Step 3: Commit.**

---

### Task 3: `auto-compaction.ts` — decision + execution + tests

**Files:**
- Create: `apps/server/src/agent/auto-compaction.ts`
- Test: `apps/server/src/agent/__tests__/auto-compaction.test.ts`

This module ports pi's `_checkCompaction` (decision) + `_runAutoCompaction` (execution). It is server-layer (has auth + DB).

**Step 1: Write failing tests for `checkCompaction`** — the pure decision over inputs (no I/O):

```ts
// covers: disabled→none; threshold hit→compact; under threshold→none;
// zero-usage fallback (z.ai case) → compact via estimate; overflow error → compact+willRetry;
// silent stop-overflow → compact+!willRetry; last entry already compaction → none.
```

**Step 2: Run → FAIL.**

**Step 3: Implement `checkCompaction`** `[PORT]` of `agent-session.ts:1816-1904`. Signature:

```ts
export interface CompactionDecision {
  action: "none" | "compact";
  reason?: "threshold" | "overflow";
  willRetry?: boolean;
}
export interface CheckCompactionInput {
  message: AssistantMessage;
  entries: SessionTreeEntry[];
  contextWindow: number;
  settings: CompactionSettings;
}
export function checkCompaction(input: CheckCompactionInput): CompactionDecision
```

Mirror pi exactly: enabled guard → skip aborted → overflow (`isContextOverflow` → `willRetry = stopReason !== "stop"`) → threshold with the zero-usage fallback (`calculateContextTokens(usage)===0 || stopReason==="error"` → `estimateContextTokens`; `lastUsageIndex===null` → none) → `shouldCompact`.

**Step 4: Implement `runAutoCompaction`** `[PORT]` of `agent-session.ts:1907-2078`, simplified (no extension hooks — sakti has no extension system yet). Signature:

```ts
export interface RunCompactionDeps {
  ctx: ServerContext;
  session: Session;            // has getBranch() + appendCompaction()
  model: Model;
  apiKey: string;
  settings: CompactionSettings;
  thinkingLevel?: ThinkingLevel;
}
export async function runAutoCompaction(
  deps: RunCompactionDeps
): Promise<{ ok: true; summary: string; firstKeptEntryId: string; tokensBefore: number } | { ok: false; errorMessage: string }>
```

Body: `entries = await session.getBranch()`; `prepareCompaction(entries, settings)` (bail if undefined); `compact(preparation, model, apiKey, undefined, undefined, undefined, thinkingLevel)`; on `!ok` return error; `await session.appendCompaction(summary, firstKeptEntryId, tokensBefore, details)`; return result. (`harness.state.messages` mutation is not needed — our harness rebuilds context from storage each turn via `createTurnState`, so persisting the compaction entry is sufficient.)

**Step 5: `parseCompactionSettings`** `[PORT]` of `settings-manager.ts:754`:

```ts
export function parseCompactionSettings(settings: Record<string, string>): CompactionSettings {
  return {
    enabled: settings.auto_compaction !== "false", // default true (pi-faithful); resurrects the dead key
    reserveTokens: Number.parseInt(settings.compaction_reserve_tokens ?? "16384", 10),
    keepRecentTokens: Number.parseInt(settings.compaction_keep_recent_tokens ?? "20000", 10),
  };
}
```

**Step 6: Run tests → PASS. Commit.**

---

### Task 4: Wire the compaction phase into `executeWithRetry`

**Files:**
- Modify: `apps/server/src/agent/retry-loop.ts`
- Test: `apps/server/src/__tests__/retry-loop.test.ts`

**Step 1: Write failing test** — a `checkCompaction`+`runCompaction` dep pair that requests a threshold compaction; assert `compaction_start`/`compaction_end` emitted and `runTurn` called again (continue). Existing 18 tests must stay green (compaction deps optional → undefined → no phase).

**Step 2: Run → FAIL.**

**Step 3: Extend `RetryRunnerDeps`** with optional compaction callbacks + an `overflowGuard`:

```ts
export interface RetryRunnerDeps {
  // ...existing...
  /** Decide whether the just-finished turn needs compaction. Optional. */
  checkCompaction?: (message: AssistantMessage) => Promise<CompactionDecision>;
  /** Run one compaction. Optional (required iff checkCompaction is). */
  runCompaction?: () => Promise<{ ok: true; result: { summary: string; firstKeptEntryId: string; tokensBefore: number } } | { ok: false; errorMessage: string }>;
}
```

Add a `runCompactionPhase(message)` after the retry while-loop (and after the disabled-retry early return). It loops: `checkCompaction` → if compact, emit `compaction_start`, `await runCompaction()`, emit `compaction_end` (result/aborted/errorMessage), and if `willRetry` re-run `runTurn()` — capped at ONE overflow retry per phase (emit a failure `compaction_end` on a second overflow). `[PORT]` of the `_overflowRecoveryAttempted` semantics.

**Step 4: Run all retry-loop tests → PASS (incl. new). Commit.**

---

### Task 5: Wire compaction deps into `runPrompt`

**Files:**
- Modify: `apps/server/src/agent/runner.ts:415-459` (the `executeWithRetry` call)

**Step 1:** After `settings` is loaded (~line 336), compute `const compactionSettings = parseCompactionSettings(settings);`

**Step 2:** Pass `checkCompaction` + `runCompaction` to the `executeWithRetry` deps:

```ts
checkCompaction: async (message) => {
  const entries = await sessionInstance.getBranch();
  return checkCompaction({ message, entries, contextWindow: model.contextWindow ?? 0, settings: compactionSettings });
},
runCompaction: async () => runAutoCompaction({ ctx, session: sessionInstance, model, apiKey: auth.apiKey, settings: compactionSettings, ...(auth.thinkingLevel ? { thinkingLevel: auth.thinkingLevel } : {}) }),
```

**Step 3:** typecheck + run server agent tests. Commit.

---

### Task 6: Verify end-to-end

**Step 1:** `pnpm run typecheck` (turbo, 7 tasks).
**Step 2:** per-package tests — `packages/llm`, `packages/agent`, `apps/server` (expect only the known pre-existing terminal/compaction-route env failures; the new auto-compaction tests must pass).
**Step 3:** `npx ultracite fix` on touched files.
**Step 4:** Manual: with `SAKTI_LOG_LEVEL=debug`, grow a session past the window and confirm `agent.log` shows `compaction_start`/`compaction_end` + `~/.sakti/sessions.db` gains a compaction entry.
**Step 5:** Commit the verification (no code change) — or roll into Task 5's commit.

---

## Out of scope (follow-ups)
- Desktop "compacting…" UI indicator (events already flow; desktop ignores them today).
- DB persistence of "always" permission grants.
- Extension hooks (`session_before_compact` / `session_compact`) — sakti has no extension system.
- `getContextUsage()` for a live context-% meter in the UI.
