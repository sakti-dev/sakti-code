# Reasonix Cache-Stability Follow-Ups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port three Reasonix cache-stability behaviors: §11 byte-stability regression tests (the measurement foundation), §13 pre-compaction prune (cheapest win), and §4 stuck guard (worst-footgun prevention).

**Architecture:** These are three independent changes, ordered by dependency: §11 first (measurement infrastructure), then §13 (prune, which §4's stuck guard interacts with), then §4 (stuck guard).

**Design references (read before starting):**
- `openspec/references/DeepSeek-Reasonix/internal/agent/cachehit_e2e_test.go` — §11 mock-DeepSeek pattern
- `openspec/references/DeepSeek-Reasonix/internal/agent/cache_shape.go` — §11 PrefixShape diagnostics
- `openspec/references/DeepSeek-Reasonix/internal/agent/prune.go` — §13 pre-compaction prune
- `openspec/references/DeepSeek-Reasonix/internal/agent/compact.go:84-135` — §4 three-tier + stuck guard
- `packages/agent/src/compaction/auto-compaction.ts` — our current single-threshold policy
- `packages/agent/src/compaction/compaction.ts` — `prepareCompaction`, `compactEffect`, `shouldCompact`
- `packages/agent/src/core/agent-loop.ts:120-140` — `runAgentLoop` (the loop under test in §11)

**Conventions (from repo `AGENTS.md`):**
- TDD: failing test → implement → pass → commit.
- Tests colocated in `__tests__/`. `vitest`. No `.only`/`.skip`.
- `exactOptionalPropertyTypes: true` → conditional spread, never pass `undefined`.
- `for...of` over `.forEach()`. Arrow callbacks. `const` by default.
- Verify each task: `cd packages/agent && pnpm run typecheck && pnpm run test`.

---

## Change A: §11 — Byte-stability regression tests

**Why first:** Without measurement, you can't prove the other two work. The test harness is the foundation for all cache-stability work.

**What Reasonix does:** A mock endpoint byte-compares consecutive requests and derives `prompt_cache_hit_tokens` from the byte-identical prefix. Hit rate becomes a direct measurement of prefix stability.

### Key insight: our faux provider already captures requests

Our `registerFauxStreamProvider` (from `packages/agent/src/__tests__/helpers/faux-provider.ts`) receives the full `StreamRequest` on every call, including `req.messages`, `req.system`, and `req.tools`. The test doesn't need a mock HTTP endpoint — it can byte-compare consecutive requests at the `StreamRequest` level.

### What "byte-stable" means for us

Between consecutive `streamFn` calls within one turn loop:
1. **System prompt** (`req.system`) — must be byte-identical.
2. **Tools** (`req.tools` keys + JSON) — must be byte-identical.
3. **Message prefix** (`req.messages[0..N-1]`) — turn N's message array must start with all of turn N-1's messages, byte-identical.

If any of these change between turns (without a compaction in between), that's a cache bust.

### Task A1: Create the cache-stability test harness

**Files:**
- Create: `packages/agent/src/core/__tests__/cache-stability-helpers.ts`
- Test: `packages/agent/src/core/__tests__/cache-stability-helpers.test.ts`

**Step 1: Write the failing test**

Test the helper functions in isolation:

```ts
import { describe, expect, it } from "vitest";
import {
  canonicalizeMessage,
  commonPrefixLength,
  measureCacheHit,
  type StreamRequestCapture,
} from "./cache-stability-helpers";

describe("commonPrefixLength", () => {
  it("returns the count of byte-identical leading items", () => {
    const a = ["x", "y", "z"];
    const b = ["x", "y", "w"];
    expect(commonPrefixLength(a, b, canonicalizeMessage)).toBe(2);
  });

  it("returns 0 when the first item differs", () => {
    expect(commonPrefixLength(["a"], ["b"], canonicalizeMessage)).toBe(0);
  });

  it("returns full length when one is a prefix of the other", () => {
    expect(commonPrefixLength(["a", "b"], ["a", "b", "c"], canonicalizeMessage)).toBe(2);
  });
});

describe("measureCacheHit", () => {
  it("returns hitChars and totalChars for a request vs the previous", () => {
    const prev: StreamRequestCapture = {
      system: "prompt",
      messages: [{ role: "user", content: "hello" }],
      toolsKeys: ["read", "write"],
      toolsJson: '{"read":{}}',
    };
    const cur: StreamRequestCapture = {
      system: "prompt", // identical
      messages: [
        { role: "user", content: "hello" },  // identical
        { role: "assistant", content: "hi" }, // new
      ],
      toolsKeys: ["read", "write"],
      toolsJson: '{"read":{}}',
    };
    const result = measureCacheHit(prev, cur);
    expect(result.prefixStable).toBe(true);
    expect(result.hitChars).toBeGreaterThan(0);
    expect(result.totalChars).toBeGreaterThan(result.hitChars);
  });

  it("detects system prompt change as prefix break", () => {
    const prev: StreamRequestCapture = {
      system: "prompt-a",
      messages: [{ role: "user", content: "hello" }],
      toolsKeys: [],
      toolsJson: "{}",
    };
    const cur: StreamRequestCapture = {
      system: "prompt-b",
      messages: [{ role: "user", content: "hello" }],
      toolsKeys: [],
      toolsJson: "{}",
    };
    const result = measureCacheHit(prev, cur);
    expect(result.prefixStable).toBe(false);
    expect(result.breakReason).toBe("system");
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- cache-stability-helpers
```

Expected: FAIL — module not found.

**Step 3: Implement**

Create `packages/agent/src/core/__tests__/cache-stability-helpers.ts`:

```ts
import type { StreamRequest } from "@sakti-code/llm";

/** A captured stream request — the byte-comparable fingerprint. */
export interface StreamRequestCapture {
  messages: unknown[];
  system: string;
  toolsJson: string;
  toolsKeys: string[];
}

/** Canonicalize a message to a stable string for byte comparison. */
export function canonicalizeMessage(msg: unknown): string {
  return JSON.stringify(msg);
}

/**
 * Count the number of byte-identical leading items between two arrays,
 * using `canonicalize` to produce the comparison key.
 */
export function commonPrefixLength<T>(
  a: T[],
  b: T[],
  canonicalize: (item: T) => string
): number {
  let n = 0;
  while (n < a.length && n < b.length) {
    if (canonicalize(a[n]!) !== canonicalize(b[n]!)) {
      break;
    }
    n++;
  }
  return n;
}

/** Result of comparing two consecutive requests for cache stability. */
export interface CacheHitMeasurement {
  /** True when system + tools are identical (the prefix is byte-stable). */
  prefixStable: boolean;
  /** Which component broke the prefix, if any. */
  breakReason: "system" | "tools" | "messages" | undefined;
  /** Characters in the byte-identical prefix. */
  hitChars: number;
  /** Total characters in the current request. */
  totalChars: number;
  /** Estimated hit rate as a percentage (0–100). */
  hitRate: number;
}

/**
 * Measure the cache stability between two consecutive stream requests.
 * Mirrors Reasonix's `commonPrefixMsgs` + `charsOf` logic, but operates
 * on our `StreamRequest` shape instead of raw DeepSeek JSON.
 */
export function measureCacheHit(
  prev: StreamRequestCapture,
  cur: StreamRequestCapture
): CacheHitMeasurement {
  let prefixStable = true;
  let breakReason: CacheHitMeasurement["breakReason"] = undefined;

  if (prev.system !== cur.system) {
    prefixStable = false;
    breakReason = "system";
  } else if (
    prev.toolsJson !== cur.toolsJson ||
    JSON.stringify(prev.toolsKeys) !== JSON.stringify(cur.toolsKeys)
  ) {
    prefixStable = false;
    breakReason = "tools";
  }

  const prefixMsgCount = commonPrefixLength(
    prev.messages,
    cur.messages,
    canonicalizeMessage
  );

  if (prefixMsgCount < prev.messages.length) {
    prefixStable = false;
    breakReason ??= "messages";
  }

  const hitChars =
    (prev.system?.length ?? 0) +
    (prev.toolsJson?.length ?? 0) +
    prev.messages
      .slice(0, prefixMsgCount)
      .reduce((sum, m) => sum + canonicalizeMessage(m).length, 0);

  const totalChars =
    (cur.system?.length ?? 0) +
    (cur.toolsJson?.length ?? 0) +
    cur.messages.reduce(
      (sum, m) => sum + canonicalizeMessage(m).length,
      0
    );

  const hitRate =
    totalChars === 0 ? 0 : Math.floor((hitChars * 100) / totalChars);

  return { prefixStable, breakReason, hitChars, totalChars, hitRate };
}

/**
 * Capture a StreamRequest into the byte-comparable shape. Used by tests
 * that want to record consecutive requests from the agent loop.
 */
export function captureRequest(req: StreamRequest): StreamRequestCapture {
  return {
    system: req.system ?? "",
    messages: req.messages,
    toolsKeys: req.tools ? Object.keys(req.tools) : [],
    toolsJson: req.tools ? JSON.stringify(req.tools) : "{}",
  };
}
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- cache-stability-helpers
```

**Step 5: Commit**

```bash
git add packages/agent/src/core/__tests__/cache-stability-helpers.ts \
        packages/agent/src/core/__tests__/cache-stability-helpers.test.ts
git commit -m "feat(agent): cache-stability measurement helpers (§11 foundation)"
```

---

### Task A2: `TestCacheHitPrefixStable` — prefix equals entire prior request

The core invariant: turn N's request prefix must equal all of turn N-1's request. If not, something broke byte-stability.

**Files:**
- Test: `packages/agent/src/core/__tests__/cache-stability.test.ts`

**Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  registerFauxStreamProvider,
} from "../../__tests__/helpers/faux-provider";
import { TestExecutionEnv } from "../../agent/__tests__/test-execution-env";
import { AgentHarness } from "../../agent/agent-harness";
import { createTestSession } from "../../session/__tests__/session-test-utils";
import {
  captureRequest,
  measureCacheHit,
} from "./cache-stability-helpers";
import type { StreamRequest } from "@sakti-code/llm";

const registrations: FauxProviderRegistration[] = [];

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.setResponses([]);
  }
});

describe("cache-stability: prefix stable across turns", () => {
  it("system prompt + tools + message prefix is byte-identical across multi-turn tool loop", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const captures: StreamRequest[] = [];

    registration.setResponses([
      () =>
        fauxAssistantMessageWithContent(
          [fauxToolCall("calculate", { expression: "1+1" }, { id: "c1" })],
          "toolUse"
        ),
      () => fauxAssistantMessage("done"),
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: (req) => {
        captures.push(req);
        return registration.streamFn(req);
      },
      systemPrompt: "frozen prompt — must not change between turns",
      tools: [calculateTool],
    });

    await harness.prompt("compute 1+1");

    expect(captures.length).toBeGreaterThanOrEqual(2);

    // Compare each consecutive pair
    for (let i = 1; i < captures.length; i++) {
      const prev = captureRequest(captures[i - 1]!);
      const cur = captureRequest(captures[i]!);
      const result = measureCacheHit(prev, cur);

      expect(result.prefixStable, `prefix broke at request ${i}: ${result.breakReason}`).toBe(true);
      // The entire prior request must be a prefix of the current one.
      // (The only new bytes should be the fresh turn's messages.)
    }
  });
});
```

**Step 2: Run — verify it passes** (This is a verification of EXISTING behavior — it should pass immediately. If it fails, we found a cache bug.)

```bash
cd packages/agent && pnpm run test -- "prefix stable across turns"
```

Expected: PASS (our loop is already append-only). If FAIL → investigate the cache bust.

**Step 3: Commit**

```bash
git add packages/agent/src/core/__tests__/cache-stability.test.ts
git commit -m "test(agent): byte-stability regression test — prefix stable across turns (§11)"
```

---

### Task A3: `TestCacheHitClimbsWithoutCompaction` — hit rate climbs past 90%

Run a long dialogue (14 turns, no compaction) and verify the hit rate climbs past 90% as the history dwarfs each turn's fresh tail.

**Files:**
- Test: append to `packages/agent/src/core/__tests__/cache-stability.test.ts`

**Step 1: Write the test**

```ts
it("hit rate climbs past 90% as history grows (no compaction)", async () => {
  const registration = registerFauxStreamProvider();
  registrations.push(registration);
  const captures: StreamRequest[] = [];

  const turnText = (n: number) =>
    `Turn ${n}: ${"please consider this requirement. ".repeat(6)}`;

  // 14 turns, each returns a short response
  registration.setResponses(
    Array.from({ length: 14 }, (_, i) => () => {
      const fn = registration.streamFn;
      return fauxAssistantMessage(`answer ${i}`);
    })
  );

  // Override streamFn to capture
  const harness = new AgentHarness({
    env: new TestExecutionEnv(process.cwd()),
    session: await createTestSession(),
    model: registration.getModel(),
    streamFn: (req) => {
      captures.push(req);
      return registration.streamFn(req);
    },
    systemPrompt: "You are a helpful assistant. Be concise.",
  });

  for (let i = 0; i < 14; i++) {
    await harness.prompt(turnText(i));
  }

  // Compute hit rate curve
  const rates: number[] = [];
  for (let i = 1; i < captures.length; i++) {
    const result = measureCacheHit(
      captureRequest(captures[i - 1]!),
      captureRequest(captures[i]!)
    );
    rates.push(result.hitRate);
  }

  // Peak should be >= 90% — the history dwarfs each fresh turn
  const peak = Math.max(...rates);
  expect(peak).toBeGreaterThanOrEqual(90);
});
```

**Step 2: Run — verify it passes**

```bash
cd packages/agent && pnpm run test -- "hit rate climbs"
```

**Step 3: Commit**

---

### Task A4: `TestCacheHitSurvivesTooSmallWindow` — stuck guard test

This test depends on Task B (stuck guard) landing first. It asserts that when the context window is too small, collapses are capped at ≤2 and the tail recovers.

**Files:**
- Test: append to `packages/agent/src/core/__tests__/cache-stability.test.ts`

**Note:** Write this test as a pending skeleton now; it will pass after Task B (stuck guard) is implemented. Mark it `it.skip` with a comment pointing to Task B.

---

## Change B: §4 — Stuck guard for auto-compaction

**Why:** Without the stuck guard, a too-small context window makes compaction rewrite the prefix every turn, cratering the cache turn after turn. This is the worst compaction footgun.

**What Reasonix does:** Tracks `consecutiveCompacts` counter. After 2 consecutive compactions without a sub-threshold turn in between, latches `compactStuck = true` and pauses auto-compaction entirely until the prompt drops back under the trigger threshold.

### Where our code changes

The stuck guard lives in the **policy layer** (`auto-compaction.ts`), not in the pure primitives (`compaction.ts`). The state (counter + latch) needs to persist across turns within a session run.

The current flow in `runner.ts`:
1. `checkCompaction(input)` — pure decision: `{ action: "compact" | "none" }`
2. `runAutoCompaction(deps)` — execute the compaction

The stuck guard adds state between these: if latched, skip even when `checkCompaction` says "compact". The state needs to live in the runner (or a stateful wrapper) because it spans multiple turns.

### Design decision: where to track stuck state

**Option A:** Add stuck state to `checkCompaction` input/output. The runner tracks `consecutiveCompacts` and passes it in.
**Option B:** Create a `CompactionPolicy` class that wraps `checkCompaction` with stateful tracking.

**Choice: Option A** — simpler, follows the existing pure-function pattern. `checkCompaction` gains an optional `consecutiveCompacts` input and the decision includes a `pauseAutoCompaction` flag when the guard latches.

### Task B1: Add stuck guard to `checkCompaction`

**Files:**
- Modify: `packages/agent/src/compaction/auto-compaction.ts`
- Test: `packages/agent/src/compaction/__tests__/auto-compaction.test.ts`

**Step 1: Write the failing tests**

Append to `auto-compaction.test.ts`:

```ts
describe("stuck guard", () => {
  const settings: CompactionSettings = {
    enabled: true,
    keepRecentTokens: 100,
    reserveTokens: 100,
  };

  it("does NOT pause when consecutiveCompacts < 2", () => {
    const message = asst("stop", {
      usage: usage({ totalTokens: 950 }),
      timestamp: 200,
    });
    const decision = checkCompaction(
      baseInput(message, {
        contextWindow: 1000,
        settings,
        consecutiveCompacts: 1,
      })
    );
    expect(decision.action).toBe("compact");
    expect(decision.pauseAutoCompaction).toBeUndefined();
  });

  it("pauses auto-compaction when consecutiveCompacts >= 2 and prompt still over threshold", () => {
    const message = asst("stop", {
      usage: usage({ totalTokens: 950 }),
      timestamp: 200,
    });
    const decision = checkCompaction(
      baseInput(message, {
        contextWindow: 1000,
        settings,
        consecutiveCompacts: 2,
      })
    );
    expect(decision.action).toBe("none");
    expect(decision.pauseAutoCompaction).toBe(true);
    expect(decision.reason).toBe("stuck_guard");
  });

  it("resets the guard when prompt drops below threshold", () => {
    const message = asst("stop", {
      usage: usage({ totalTokens: 500 }),
      timestamp: 200,
    });
    const decision = checkCompaction(
      baseInput(message, {
        contextWindow: 1000,
        settings,
        consecutiveCompacts: 2, // was stuck, but now below threshold
      })
    );
    expect(decision.action).toBe("none");
    expect(decision.pauseAutoCompaction).toBeUndefined();
    expect(decision.resetStuckGuard).toBe(true);
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- "stuck guard"
```

**Step 3: Implement**

In `auto-compaction.ts`:

3a. Extend `CheckCompactionInput`:

```ts
export interface CheckCompactionInput {
  // ... existing fields ...
  /**
   * Number of consecutive compactions that have fired without a
   * sub-threshold turn in between. Tracked by the caller (runner).
   * When ≥2 and the prompt is still over threshold, the stuck guard
   * latches and auto-compaction is paused.
   */
  consecutiveCompacts?: number;
}
```

3b. Extend `CompactionDecision`:

```ts
export interface CompactionDecision {
  action: "none" | "compact";
  reason?: CompactionReason | "stuck_guard";
  willRetry?: boolean;
  /** True when the stuck guard has latched — caller should stop auto-compacting. */
  pauseAutoCompaction?: boolean;
  /** True when a sub-threshold turn clears the stuck guard — caller should reset the counter. */
  resetStuckGuard?: boolean;
}
```

3c. Add stuck guard logic to `checkCompaction`, right before the `shouldCompact` check:

```ts
  // Stuck guard: if we've compacted twice in a row and the prompt is STILL
  // over threshold, the context window is too small for compaction to help.
  // Pause auto-compaction to avoid rewriting the prefix every turn.
  const isOverThreshold = shouldCompact(contextTokens, input.contextWindow, settings);
  if (isOverThreshold && (input.consecutiveCompacts ?? 0) >= 2) {
    return {
      action: "none",
      reason: "stuck_guard",
      pauseAutoCompaction: true,
    };
  }

  // Sub-threshold turn: reset the stuck guard counter.
  if (!isOverThreshold) {
    if ((input.consecutiveCompacts ?? 0) > 0) {
      return { action: "none", resetStuckGuard: true };
    }
    return { action: "none" };
  }
```

Wait — the existing code returns `{ action: "none" }` when NOT over threshold. The reset flag needs to be returned in that path. Let me restructure:

Actually, the existing flow is:
1. Various guards (disabled, aborted, stale, overflow) → early returns
2. Compute `contextTokens`
3. `shouldCompact(contextTokens, contextWindow, settings)` → if true, return compact; else return none

The stuck guard inserts BETWEEN steps 2 and 3:

```ts
  // After computing contextTokens, before shouldCompact:
  const overThreshold = shouldCompact(
    contextTokens,
    input.contextWindow,
    settings
  );

  // Stuck guard: 2+ consecutive compactions + still over threshold = pause.
  if (overThreshold && (input.consecutiveCompacts ?? 0) >= 2) {
    return {
      action: "none",
      reason: "stuck_guard",
      pauseAutoCompaction: true,
    };
  }

  if (!overThreshold) {
    // Sub-threshold turn: signal counter reset if it was non-zero.
    return (input.consecutiveCompacts ?? 0) > 0
      ? { action: "none", resetStuckGuard: true }
      : { action: "none" };
  }

  return { action: "compact", reason: "threshold", willRetry: false };
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- "stuck guard"
```

**Step 5: Commit**

```bash
git add packages/agent/src/compaction/auto-compaction.ts \
        packages/agent/src/compaction/__tests__/auto-compaction.test.ts
git commit -m "feat(agent): stuck guard pauses auto-compaction on too-small windows (§4)"
```

---

### Task B2: Wire stuck guard state into the runner

The runner needs to track `consecutiveCompacts` across turns and pass it to `checkCompaction`.

**Files:**
- Modify: `apps/server/src/agent/runner.ts` — track counter, pass to `checkCompaction`, honor `pauseAutoCompaction` / `resetStuckGuard`

**Step 1: Write the failing test**

This is integration-level; the unit tests in B1 cover the decision logic. For the runner, verify via the existing `runPrompt` test patterns that the counter is tracked.

**Step 2: Implement**

In `runner.ts`, inside `runPrompt` (around the `executeWithRetry` block):

```ts
// Stuck guard state: tracks consecutive compactions within this run.
let consecutiveCompacts = 0;
let autoCompactionPaused = false;
```

In the `checkCompaction` callback:

```ts
checkCompaction: async (assistantMessage) => {
  // ... existing logic ...
  return checkCompaction({
    message: assistantMessage,
    messages,
    contextWindow: model.contextWindow ?? 0,
    settings: compactionSettings,
    ...(latestCompactionTimestamp === undefined
      ? {}
      : { latestCompactionTimestamp }),
    ...(consecutiveCompacts > 0
      ? { consecutiveCompacts }
      : {}),
  });
},
```

In the `runCompaction` callback:

```ts
runCompaction: async () => {
  if (autoCompactionPaused) {
    return { ok: false, errorMessage: "Auto-compaction paused (stuck guard)" };
  }
  const result = await runAutoCompaction({ ... });
  if (result.ok) {
    consecutiveCompacts++;
  }
  return result;
},
```

After `checkCompaction` returns (in `executeWithRetry`'s decision handling):

```ts
if (decision.resetStuckGuard) {
  consecutiveCompacts = 0;
  autoCompactionPaused = false;
}
if (decision.pauseAutoCompaction) {
  autoCompactionPaused = true;
  ctx.log?.agent.warn("auto-compaction paused (stuck guard)", { sessionId });
}
```

**Note:** The exact wiring depends on how `executeWithRetry` surfaces the `CompactionDecision` to the callbacks. Check `packages/agent/src/compaction/retry-loop.ts` for the integration seam — `checkCompaction` returns the decision, and the retry loop acts on `decision.action === "compact"` by calling `runCompaction`. The stuck guard flags need to be handled where the decision is consumed.

**Step 3: Run typecheck + test**

```bash
cd apps/server && pnpm run typecheck && pnpm run test
```

**Step 4: Commit**

```bash
git add apps/server/src/agent/runner.ts
git commit -m "feat(server): wire stuck guard state into runPrompt (§4)"
```

---

## Change C: §13 — Pre-compaction prune

**Why:** Before paying for a summarizer LLM call, elide stale tool results ≥1024 bytes. Tool output is re-derivable (re-read the file, re-run the command); the summarizer costs a network round-trip and tokens. Pruning is free and often sufficient.

**What Reasonix does:**
1. Identify tool results outside the "recent tail" window.
2. Replace their content with `[elided tool result — <name>, <N> bytes dropped to save context; re-run the tool if the data is needed again]`.
3. If pruning alone clears the compaction trigger, skip the summarizer call entirely.
4. Archive originals first (we skip this — our session store is append-only, so the original entries survive).

### Where our code changes

The prune pass lives in the compaction pipeline, between `prepareCompaction` and `compactEffect`. It operates on the **messages** being sent to the summarizer, not on the session entries (the session stays append-only).

Actually — let me re-read our compaction flow. `prepareCompaction` returns `{ messagesToSummarize, firstKeptEntryId, ... }`. The prune pass would replace content in `messagesToSummarize` before they go to the summarizer.

But wait — the prune pass in Reasonix is **session-level** (it rewrites `session.Replace(next)`), not summarizer-level. It prunes stale tool results from the LIVE session, so the next turn's request to the main model doesn't carry them.

In our architecture, we can't rewrite session entries (append-only). But we CAN prune in the **context-building** phase — when building the message array for the next turn, elide stale tool results that are outside the recent tail.

Actually, looking more carefully at the Reasonix code: the prune rewrites the session messages in-place (`a.session.Replace(next)`), which means subsequent turns see the pruned content. The summarizer call is then skipped if pruning cleared the threshold.

For us, the equivalent would be: **before the compaction summarizer call**, prune stale tool results from the messages being sent to the summarizer. If the pruned messages are short enough, skip the summarizer entirely.

BUT — our compaction doesn't send messages to the summarizer from the live session; it sends them from the `prepareCompaction` result. And `prepareCompaction` determines which messages to summarize based on the `keepRecentTokens` cut point.

Let me think about this differently. The prune pass has two goals:
1. **Save tokens on the summarizer call** — prune stale tool results before sending to the summarizer.
2. **Skip the summarizer entirely** if pruning alone clears the trigger.

For goal 1: we can prune in the messages that `prepareCompaction` sends to `compactEffect`. This is a content-only change to the messages array — no session mutation.

For goal 2: we need to estimate whether the pruned content brings us under the threshold. This requires the token estimate from the current turn's usage.

### Design decision: prune at the policy layer, not in the compaction primitives

The prune pass is a **policy** decision (should we skip the summarizer?), so it belongs in `auto-compaction.ts`, not in the pure `compaction.ts` primitives. The implementation:

1. Add a `pruneStaleToolResults(messages, options)` pure function that returns pruned messages + stats.
2. In `runAutoCompactionEffect`, before calling `compactEffect`, run the prune pass on `preparation.messagesToSummarize`.
3. If the estimated token savings bring the context under the threshold, skip the summarizer and instead just persist a compaction entry that references the pruned content.

Actually, that's complex. Let me simplify:

**Simpler approach:** The prune pass replaces stale tool-result content in the messages before they're sent to the summarizer. The summarizer then summarizes less data (cheaper call, fewer tokens). This is a pure optimization on the summarizer input — it doesn't skip the call.

**Even simpler:** Add the prune as a pre-processing step in `compactEffect` or in the preparation. This way every compaction benefits from pruning, not just auto-compaction.

**Final decision:** Add `pruneStaleToolResults` as a pure utility in `compaction.ts`, call it inside `prepareCompaction` to shrink `messagesToSummarize` before the summarizer sees them. This is the simplest integration point and benefits both auto-compaction and manual compaction.

### Task C1: `pruneStaleToolResults` pure function

**Files:**
- Create: `packages/agent/src/compaction/prune.ts`
- Test: `packages/agent/src/compaction/__tests__/prune.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { pruneStaleToolResults } from "../prune";
import type { AgentMessage } from "../../types";

function toolResultMessage(
  name: string,
  content: string,
  toolCallId = "call-1"
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: name,
    content: [{ type: "text", text: content }],
    isError: false,
    timestamp: Date.now(),
  } as AgentMessage;
}

describe("pruneStaleToolResults", () => {
  const minPruneBytes = 1024;

  it("elides tool results >= minPruneBytes outside the tail", () => {
    const largeContent = "x".repeat(2048);
    const messages: AgentMessage[] = [
      toolResultMessage("read", largeContent),
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 0 },
    ];

    const { pruned, stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1, // protect the last message
      minPruneBytes,
    });

    expect(stats.results).toBe(1);
    expect(stats.savedChars).toBeGreaterThan(0);
    const prunedMsg = pruned[0] as ReturnType<typeof toolResultMessage>;
    const text = (prunedMsg.content[0] as { text: string }).text;
    expect(text).toContain("[elided tool result");
    expect(text).toContain("read");
    expect(text).toContain("2048 bytes dropped");
  });

  it("does NOT prune tool results inside the tail", () => {
    const largeContent = "x".repeat(2048);
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "old" }], timestamp: 0 },
      toolResultMessage("read", largeContent),
    ];

    const { pruned, stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(0);
    expect(pruned).toEqual(messages);
  });

  it("does NOT prune small tool results", () => {
    const messages: AgentMessage[] = [
      toolResultMessage("read", "small"),
    ];

    const { stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(0);
  });

  it("does NOT prune error tool results", () => {
    const largeContent = "x".repeat(2048);
    const messages: AgentMessage[] = [
      { ...toolResultMessage("bash", largeContent), isError: true } as AgentMessage,
    ];

    const { stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(0);
  });

  it("is idempotent — does not re-prune already-elided results", () => {
    const messages: AgentMessage[] = [
      toolResultMessage("read", "[elided tool result — read, 2048 bytes dropped to save context]"),
    ];

    const { stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(0);
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- prune
```

**Step 3: Implement**

Create `packages/agent/src/compaction/prune.ts`:

```ts
import type { AgentMessage } from "../types";

const PRUNED_MARKER = "[elided tool result — ";
export const DEFAULT_MIN_PRUNE_BYTES = 1024;

export interface PruneOptions {
  /** Messages from this index onward are protected (the "tail"). */
  tailStartIndex: number;
  /** Minimum content bytes to consider pruning. Default 1024. */
  minPruneBytes?: number;
}

export interface PruneStats {
  /** Number of tool results elided. */
  results: number;
  /** Characters saved (original content length - placeholder length). */
  savedChars: number;
}

/**
 * Elide stale tool-result content older than the recent tail.
 *
 * Tool output is re-derivable (re-read the file, re-run the command). Before
 * paying for a compaction summarizer call, replace large tool results outside
 * the tail with a short placeholder. The tool-call/result pairing is untouched
 * (only content changes, not roles/IDs).
 *
 * Error tool results are kept verbatim (they're not re-derivable).
 * Already-elided results are skipped (idempotency).
 */
export function pruneStaleToolResults(
  messages: AgentMessage[],
  options: PruneOptions
): { pruned: AgentMessage[]; stats: PruneStats } {
  const minPruneBytes = options.minPruneBytes ?? DEFAULT_MIN_PRUNE_BYTES;
  const stats: PruneStats = { results: 0, savedChars: 0 };

  if (messages.length === 0) {
    return { pruned: messages, stats };
  }

  let modified = false;
  const result = [...messages];

  for (let i = 0; i < options.tailStartIndex && i < result.length; i++) {
    const msg = result[i]!;
    if (msg.role !== "toolResult") {
      continue;
    }

    const contentText = extractTextContent(msg);
    if (contentText.length < minPruneBytes) {
      continue;
    }
    if (contentText.startsWith(PRUNED_MARKER)) {
      continue;
    }
    // Keep error results verbatim.
    if ((msg as { isError?: boolean }).isError) {
      continue;
    }

    const toolName = (msg as { toolName?: string }).toolName ?? "unknown";
    const placeholder = `${PRUNED_MARKER}${toolName}, ${contentText.length} bytes dropped to save context; re-run the tool if the data is needed again]`;
    stats.savedChars += contentText.length - placeholder.length;
    stats.results++;

    result[i] = {
      ...msg,
      content: [{ type: "text", text: placeholder }],
    } as AgentMessage;
    modified = true;
  }

  return { pruned: modified ? result : messages, stats };
}

function extractTextContent(msg: AgentMessage): string {
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          part.type === "text" &&
          typeof part.text === "string"
      )
      .map((part) => part.text)
      .join("");
  }
  return "";
}
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- prune
```

**Step 5: Commit**

```bash
git add packages/agent/src/compaction/prune.ts \
        packages/agent/src/compaction/__tests__/prune.test.ts
git commit -m "feat(agent): pruneStaleToolResults elides large stale tool output (§13)"
```

---

### Task C2: Integrate prune into `prepareCompaction`

Run the prune pass on `messagesToSummarize` before they go to the summarizer.

**Files:**
- Modify: `packages/agent/src/compaction/compaction.ts` — call prune inside `prepareCompaction`
- Test: `packages/agent/src/compaction/__tests__/prune.test.ts` — add integration test

**Step 1: Write the failing test**

```ts
it("prepareCompaction prunes stale tool results in messagesToSummarize", () => {
  // Build a session with entries that include a large tool result
  // in the summarize range and a small one in the tail.
  // Assert messagesToSummarize has the elided placeholder.
});
```

**Step 2: Implement**

In `compaction.ts`, inside `prepareCompaction`, after computing `messagesToSummarize`:

```ts
import { pruneStaleToolResults } from "./prune";

// ... inside prepareCompaction, after messagesToSummarize is computed:

// Pre-compaction prune: elide large stale tool results to shrink
// the summarizer input. Tool output is re-derivable; the summarizer
// doesn't need the full content.
const { pruned: prunedMessages, stats: pruneStats } = pruneStaleToolResults(
  messagesToSummarize,
  { tailStartIndex: 0 } // messagesToSummarize is ALL outside the kept tail
);
```

Wait — `messagesToSummarize` is the range that WILL be summarized. Everything in it is "outside the tail" by definition (the tail is what's kept). So `tailStartIndex` should be `messagesToSummarize.length` (protect nothing within the summarize range — prune everything). Actually no — the point is that ALL messages in `messagesToSummarize` are candidates for pruning since they're all being summarized away.

Actually, re-reading the Reasonix code: the prune pass operates on the FULL session messages (not just the summarize range). It prunes tool results that are "outside the tail" (i.e., in the range that will be dropped after compaction). The pruned messages then become the session's new content, and if that's short enough, the summarizer is skipped.

For us, the integration is different: `prepareCompaction` already determines `messagesToSummarize` (the content to summarize) and the kept tail. We prune within `messagesToSummarize` to make the summarizer call cheaper. This is a simpler integration that doesn't skip the call.

**Step 3: Run — verify it passes**

**Step 4: Commit**

---

### Task C3: Skip summarizer when prune alone clears the threshold

This is the "free win" part: if pruning brings the estimated token count under the threshold, skip the summarizer call entirely and just drop the old messages (they're already elided).

**Files:**
- Modify: `packages/agent/src/compaction/auto-compaction.ts` — add prune-before-compact logic to `runAutoCompactionEffect`

This is the more complex integration. The flow:
1. Before calling `compactEffect`, run prune on the full message list.
2. Estimate the token savings.
3. If `promptTokens - estimatedSavings < threshold`, skip the summarizer and instead create a compaction entry with a generic summary ("Pruned N stale tool results — no summary needed").

**Step 1: Write the failing test**

Test that `runAutoCompactionEffect` skips the LLM call when pruning is sufficient.

**Step 2: Implement**

In `runAutoCompactionEffect`, after `prepareCompaction`:

```ts
// Pre-compaction prune: try to clear the threshold without an LLM call.
const { pruned, stats } = pruneStaleToolResults(
  buildSessionContextFromEntries(entries).messages,
  { tailStartIndex: cutPointTailStart }
);

if (stats.results > 0) {
  // Estimate token savings (~4 chars/token heuristic).
  const estimatedTokensSaved = Math.floor(stats.savedChars / 4);
  // If pruning alone brings us under the threshold, skip the summarizer.
  if (currentTokens - estimatedTokensSaved < threshold) {
    // Persist a compaction entry with a prune-only summary.
    yield* deps.session.appendCompaction(
      `[pruned] Elided ${stats.results} stale tool results (${estimatedTokensSaved} tokens est.). No summary needed.`,
      firstKeptEntryId,
      tokensBefore,
      { pruneOnly: true, ...stats }
    );
    return { ok: true, summary: "pruned", firstKeptEntryId, tokensBefore };
  }
}
```

**Note:** This requires access to `currentTokens` (from the last assistant usage) and `threshold` (from settings). These need to be threaded into `runAutoCompactionEffect` via `RunCompactionDeps` or computed from the session.

**Step 3: Run — verify it passes**

**Step 4: Commit**

---

## Execution order

```
A1 (helpers) → A2 (prefix-stable test) → A3 (hit-rate test)
B1 (stuck guard logic) → B2 (wire into runner)
C1 (prune function) → C2 (integrate into prepareCompaction) → C3 (skip summarizer)
```

A and B and C are independent — they can be done in any order. But A should land first because B2's "too small window" test (A4) depends on the stuck guard being in place. C is fully independent.

**Recommended commit sequence:**
1. A1 — cache-stability helpers
2. A2 — prefix-stable test (verify existing behavior)
3. A3 — hit-rate-climbs test
4. B1 — stuck guard logic
5. C1 — prune function
6. C2 — integrate prune into prepareCompaction
7. B2 — wire stuck guard into runner
8. C3 — skip summarizer when prune suffices
9. A4 — un-skip the too-small-window test (now that B is in)

## Final verification

After all tasks:

```bash
pnpm run fix                              # format + lint
pnpm run typecheck                        # all packages
cd packages/agent && pnpm run test        # full agent suite
cd apps/server && pnpm run test           # full server suite
```

## Out-of-scope follow-ups

- §6 reasoning_content drop (provider-specific to Z.ai, needs profiling)
- §10 PrefixShape diagnostics (needs §11 infrastructure to land first)
- §5 fold invariants audit (correctness audit, not perf)
- §7 tool schema sort (trivial, low priority)
- §12 PR cache-impact hygiene (cultural/process)
