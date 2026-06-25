# Application-Level Retry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port pi's application-level retry system — after a failed LLM turn, classify the error, emit retry events with exponential backoff, and re-run the turn with full UI visibility.

**Architecture:** Retry lives in the server's WS runner (wrapping `harness.prompt()`), not in the agent loop or SDK. The error classifier lives in `packages/llm`. A new `harness.continue()` method re-enters the loop after moving the session leaf past the failed message. Retry events (`auto_retry_start` / `auto_retry_end`) are `AgentEvent` variants that flow through the existing WS → UI pipeline. The desktop UI shows a retry banner.

**Tech Stack:** TypeScript, vitest, @sakti-code/agent, @sakti-code/llm, Hono WS, SolidJS

**Reference:** `openspec/references/pi/packages/ai/src/utils/retry.ts` (error classifier), `openspec/references/pi/packages/coding-agent/src/core/agent-session.ts:2490-2557` (retry loop + events), `openspec/references/pi/packages/coding-agent/src/core/settings-manager.ts:807-813` (retry settings defaults).

---

## Constraints

- `exactOptionalPropertyTypes: true` — conditional spread `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- `noUncheckedIndexedAccess: true` — indexed access is `T | undefined`.
- Biome: `noExcessiveCognitiveComplexity: 20`, `noDelete`, `noNestedTernary`, `useLiteralKeys`, `useTopLevelRegex`.
- No `any`/`console.log`/`debugger`. `unknown` over `any`.
- Tests in `__tests__/` colocated with source, vitest `globals: true`, node env.
- TDD: write failing test → verify RED → implement → verify GREEN → commit.
- Many helpful comments on production TS code (user preference).
- Before commit: `nubx ultracite fix`. Typecheck + tests must be green.

---

## Phase 1 — Revert SDK-level maxRetries (cleanup) ✓ DONE (`bfa54a87`)

> The previous approach made `maxRetries` configurable on `StreamRequest`/`CompleteRequest`/`AgentLoopConfig`. We're replacing that with application-level retry. SDK retry stays at 0.

### Task 1.1: Revert maxRetries from packages/llm

**Files:**
- Modify: `packages/llm/src/stream.ts` (revert `maxRetries` field + pass-through)
- Modify: `packages/llm/src/complete.ts` (same)

**Step 1: Revert the changes**

In `stream.ts`:
- Remove the `maxRetries?: number` field from `StreamRequest`.
- Change `maxRetries: req.maxRetries ?? 0` back to `maxRetries: 0` in the `runner({...})` call.

In `complete.ts`:
- Remove the `maxRetries?: number` field from `CompleteRequest`.
- Change `maxRetries: req.maxRetries ?? 0` back to `maxRetries: 0` in the `runner({...})` call.

**Step 2: Verify**

Run: `cd packages/llm && nub run typecheck && nub run test`
Expected: PASS (117/117 tests, typecheck clean)

**Step 3: Commit**

```bash
git add packages/llm/src/stream.ts packages/llm/src/complete.ts
git commit -m "revert(llm): remove maxRetries from StreamRequest/CompleteRequest

SDK retry stays at 0. Application-level retry will handle transient
errors with UI visibility (see docs/plans/2026-06-25-application-level-retry.md)."
```

### Task 1.2: Revert maxRetries from packages/agent

**Files:**
- Modify: `packages/agent/src/types.ts` (remove `maxRetries` from `AgentLoopConfig`)
- Modify: `packages/agent/src/loop/agent-loop.ts` (remove the pass-through line)

**Step 1: Revert**

In `types.ts`: Remove the `maxRetries?: number | undefined` field + its JSDoc from `AgentLoopConfig`.

In `agent-loop.ts`: Remove the line `...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),` from the `streamFunction({...})` call in `streamAssistantResponse`.

**Step 2: Verify**

Run: `cd packages/agent && nub run typecheck && nub run test`
Expected: PASS (111/111 tests, typecheck clean)

**Step 3: Commit**

```bash
git add packages/agent/src/types.ts packages/agent/src/loop/agent-loop.ts
git commit -m "revert(agent): remove maxRetries from AgentLoopConfig"
```

---

## Phase 2 — Port `isRetryableAssistantError` to packages/llm ✓ DONE (`c102ae3`)

> Ports pi's battle-tested error classifier (`openspec/references/pi/packages/ai/src/utils/retry.ts`). This classifies whether a failed assistant message (stopReason: "error") should be retried based on the error message text.

### Task 2.1: Write failing tests for isRetryableAssistantError

**Files:**
- Create: `packages/llm/src/__tests__/retry.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../types.ts";
import { isRetryableAssistantError } from "../retry.ts";

/** Helper: build a minimal error assistant message. */
function errorMsg(message: string): AssistantMessage {
  return {
    api: "ai-sdk",
    content: [{ type: "text", text: "" }],
    errorMessage: message,
    model: "test-model",
    provider: "test",
    role: "assistant",
    stopReason: "error",
    timestamp: Date.now(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

/** Helper: build a non-error assistant message. */
function okMsg(): AssistantMessage {
  return { ...errorMsg(""), stopReason: "stop", errorMessage: undefined };
}

describe("isRetryableAssistantError", () => {
  describe("returns false for non-error messages", () => {
    it("returns false when stopReason is not 'error'", () => {
      expect(isRetryableAssistantError(okMsg())).toBe(false);
    });

    it("returns false when errorMessage is undefined", () => {
      const msg = { ...errorMsg(""), errorMessage: undefined };
      expect(isRetryableAssistantError(msg)).toBe(false);
    });
  });

  describe("returns true for transient errors", () => {
    const transientErrors = [
      "Error 429: Rate limited",
      "The server had an error while processing your request",
      "Service temporarily unavailable (503)",
      "Bad gateway (502)",
      "Gateway timeout (504)",
      "Anthropic is overloaded",
      "Connection refused",
      "fetch failed: ECONNREFUSED",
      "socket hang up",
      "Request timed out after 30000ms",
      "stream ended before message_stop",
      "WebSocket closed unexpectedly",
      "provider returned error",
      "you can retry your request after a brief wait",
    ];

    for (const errorText of transientErrors) {
      it(`retries: "${errorText.slice(0, 40)}…"`, () => {
        expect(isRetryableAssistantError(errorMsg(errorText))).toBe(true);
      });
    }
  });

  describe("returns false for non-retryable errors", () => {
    const permanentErrors = [
      "insufficient_quota: You exceeded your current quota",
      "FreeUsageLimitError: monthly limit reached",
      "GoUsageLimitError: weekly limit reached",
      "billing: Your plan has been deactivated",
      "quota exceeded for this API key",
      "out of budget",
      "Monthly usage limit reached. Please upgrade.",
      "available balance is insufficient",
    ];

    for (const errorText of permanentErrors) {
      it(`does not retry: "${errorText.slice(0, 40)}…"`, () => {
        expect(isRetryableAssistantError(errorMsg(errorText))).toBe(false);
      });
    }
  });

  describe("returns false for unknown errors", () => {
    it("does not retry unrecognized error messages", () => {
      expect(isRetryableAssistantError(errorMsg("something unusual happened"))).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/llm && npx vitest run src/__tests__/retry.test.ts`
Expected: FAIL — module `../retry.ts` not found.

### Task 2.2: Implement isRetryableAssistantError

**Files:**
- Create: `packages/llm/src/retry.ts`

**Step 1: Write the implementation**

Port verbatim from `openspec/references/pi/packages/ai/src/utils/retry.ts` (96 lines). Two regex pattern builders + the classifier function. Every pattern is annotated with the real-world incident that motivated it.

```typescript
import type { AssistantMessage } from "./types.ts";

/**
 * # Transient error classifier for retry decisions
 *
 * Ported verbatim from pi-ai (`packages/ai/src/utils/retry.ts`). This carries
 * production-hardened knowledge of which provider/transport errors are worth
 * retrying vs. which represent permanent failures (billing, quota, auth).
 *
 * Used by the server's WS runner to decide whether a failed assistant turn
 * should be retried with exponential backoff.
 *
 * ## Classification rules
 *
 * - `stopReason !== "error"` → not retryable (not an error)
 * - No `errorMessage` → not retryable
 * - Error matches {@link NON_RETRYABLE_LIMIT_PATTERN} → NOT retryable
 *   (billing, quota, subscription limits)
 * - Error matches {@link RETRYABLE_ERROR_PATTERN} → retryable
 *   (overloaded, rate limit, network, timeout, stream failures)
 * - Neither pattern matches → NOT retryable (unknown error, fail fast)
 */

/** Build a case-insensitive regex from a list of patterns. */
function buildProviderErrorPattern(patterns: readonly string[]): RegExp {
  return new RegExp(patterns.join("|"), "i");
}

/**
 * Errors that represent permanent provider/account limits.
 * These must NOT be retried — they'll fail identically every time.
 */
const NON_RETRYABLE_LIMIT_PATTERN = buildProviderErrorPattern([
  // OpenCode Go/free-tier limits returned as 429 JSON error types by OpenCode's
  // Zen API. These are subscription/account limits, not transient throttles.
  "GoUsageLimitError",
  "FreeUsageLimitError",

  // OpenCode Go subscription-limit text asks users to enable available-balance
  // usage after rolling/weekly/monthly limits are reached.
  "Monthly usage limit reached",
  "available balance",

  // Generic quota/budget/billing exhaustion. `insufficient_quota` is OpenAI's
  // quota/billing error code; the other strings cover common gateway wording.
  "insufficient_quota",
  "out of budget",
  "quota exceeded",
  "billing",
]);

/**
 * Errors that are typically transient — worth retrying after a backoff delay.
 * Each entry is annotated with the real-world incident that motivated it.
 */
const RETRYABLE_ERROR_PATTERN = buildProviderErrorPattern([
  // Generic provider load, HTTP status, and server-side transient failures.
  "overloaded",
  "rate.?limit",
  "too many requests",
  "429",
  "500",
  "502",
  "503",
  "504",
  "service.?unavailable",
  "server.?error",
  "internal.?error",

  // Wrapper/provider text for transient upstream failures, including OpenRouter
  // "Provider returned error" responses (#2264).
  "provider.?returned.?error",

  // Network, proxy, and fetch transport failures. This includes OpenAI Codex
  // raw-fetch failures such as "upstream connect", "connection refused", and
  // "reset before headers" (#733), plus OpenRouter connection drops (#3317).
  "network.?error",
  "connection.?error",
  "connection.?refused",
  "connection.?lost",
  "other side closed",
  "fetch failed",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "timed?out",
  "timeout",
  "terminated",

  // WebSocket transports can report close/error text instead of HTTP/fetch text.
  "websocket.?closed",
  "websocket.?error",

  // Premature stream endings from SDKs and transports. Anthropic can throw
  // "stream ended without ..." and "Anthropic stream ended before message_stop"
  // (#4433); Bedrock/Smithy can throw an HTTP/2 no-response error (#3594).
  "ended without",
  "stream ended before message_stop",
  "http2 request did not get a response",

  // Provider-requested retry delay cap failures should flow through the outer
  // retry policy so callers can surface/abort the backoff (#1123).
  "retry delay",

  // Explicit retry guidance emitted mid-stream by OpenAI Responses and Bedrock
  // stream exceptions (#6019).
  "you can retry your request",
  "try your request again",
  "please retry your request",
]);

/**
 * Classify whether a failed assistant message looks like a transient provider
 * or transport error, so the caller can decide if the turn should be retried.
 *
 * This does NOT implement retry policy. Callers should first handle context
 * overflow separately (that needs compaction, not retry), then apply their own
 * retry budget, backoff, and reporting before restarting the turn.
 */
export function isRetryableAssistantError(message: AssistantMessage): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) {
    return false;
  }
  const errorMessage = message.errorMessage;
  if (NON_RETRYABLE_LIMIT_PATTERN.test(errorMessage)) {
    return false;
  }
  return RETRYABLE_ERROR_PATTERN.test(errorMessage);
}
```

**Step 2: Run test to verify it passes**

Run: `cd packages/llm && npx vitest run src/__tests__/retry.test.ts`
Expected: PASS (all tests green)

**Step 3: Export from index.ts**

Add to `packages/llm/src/index.ts`:
```typescript
// Transient error classifier for retry decisions.
export { isRetryableAssistantError } from "./retry.ts";
```

**Step 4: Verify full suite**

Run: `cd packages/llm && nub run typecheck && nub run test`
Expected: PASS (118 tests — 117 existing + 1 new test file)

**Step 5: Commit**

```bash
git add packages/llm/src/retry.ts packages/llm/src/__tests__/retry.test.ts packages/llm/src/index.ts
git commit -m "feat(llm): port isRetryableAssistantError from pi-ai

Battle-tested error classifier for retry decisions. Checks stopReason,
screens out permanent failures (billing/quota/subscription limits),
then matches transient errors (overloaded, rate limit, network, timeout,
stream failures) against a curated regex table."
```

---

## Phase 3 — Add retry event types + `harness.continue()` to packages/agent ✓ DONE (`0b55b57`)

> The agent package gains two new `AgentEvent` variants and a `harness.continue()` method that re-enters the loop after moving the session leaf past the failed message.

### Task 3.1: Add auto_retry event types

**Files:**
- Modify: `packages/agent/src/types.ts`

**Step 1: Add the event variants**

Find the `AgentEvent` union in `types.ts`. Add two new variants:

```typescript
  /** Emitted before sleeping before a retry attempt. Server-only — the agent loop never emits this. */
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  /** Emitted after a retry attempt completes (success or final failure). Server-only. */
  | {
      type: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string;
    }
```

**Step 2: Verify**

Run: `cd packages/agent && nub run typecheck`
Expected: PASS (types compile clean)

### Task 3.2: Write failing test for harness.continue()

**Files:**
- Create or modify: `packages/agent/src/__tests__/harness/agent-harness-continue.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
// Use existing test helpers from the harness test suite.
// The test creates a harness with a faux stream that returns an error on the
// first call, then succeeds on continue().

describe("AgentHarness.continue()", () => {
  it("re-runs the agent loop from current session state after leaf rollback", async () => {
    // 1. Create harness with faux stream that succeeds.
    // 2. prompt("hello") → returns assistant message with stopReason: "stop"
    // 3. Manually append a user message to session
    // 4. Call continue() → should run the loop again and return a new assistant message
    // 5. Assert: continue() returned an assistant message, session has new entry
  });

  it("throws if called while busy", async () => {
    // harness.phase !== "idle" → throws AgentHarnessError("busy")
  });

  it("throws if session has no messages", async () => {
    // Empty session → throws
  });

  it("throws if last message is assistant (need user/toolResult)", async () => {
    // Session ends with assistant → throws
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run src/__tests__/harness/agent-harness-continue.test.ts`
Expected: FAIL — `harness.continue is not a function`.

### Task 3.3: Implement harness.continue()

**Files:**
- Modify: `packages/agent/src/harness/agent-harness.ts`

**Step 1: Implement the method**

Add a `continue()` method to `AgentHarness` that:
1. Checks `this.phase === "idle"` (throw if busy)
2. Calls `this.session.getBranch()` to get the current path
3. Checks the last entry is not an assistant message (throw if it is)
4. Calls `this.session.buildContext()` to rebuild the agent context
5. Sets `this.phase = "turn"`
6. Calls `runAgentLoopContinue(context, config, emit, signal, streamFn)` — reusing the same turn-state/config-building logic as `executeTurn()`
7. Returns the last `AssistantMessage`

The method mirrors `prompt()` but:
- Does NOT create a new user message
- Does NOT emit `before_agent_start` hook (the prompt hasn't changed)
- Calls `runAgentLoopContinue()` instead of `runAgentLoop()`

Key code structure (adapt from existing `prompt()` + `executeTurn()`):

```typescript
/**
 * Continue from the current transcript. The session's last entry must be a
 * user or toolResult message (not assistant). Used by the server's retry
 * loop to re-run a failed turn after rolling back the session leaf.
 *
 * @returns The last assistant message from the continued turn.
 */
async continue(): Promise<AssistantMessage> {
  if (this.phase !== "idle") {
    throw new AgentHarnessError("busy", "AgentHarness is busy");
  }

  const turnState = await this.createTurnState();
  const context = await this.session.buildContext();

  if (context.messages.length === 0) {
    throw new AgentHarnessError("invalid_state", "No messages to continue from");
  }

  const lastMessage = context.messages[context.messages.length - 1]!;
  if (lastMessage.role === "assistant") {
    throw new AgentHarnessError(
      "invalid_state",
      "Cannot continue from assistant message"
    );
  }

  this.phase = "turn";
  const finishRunPromise = this.startRunPromise();
  try {
    const abortController = new AbortController();
    this.runAbortController = abortController;

    const newMessages = await runAgentLoopContinue(
      {
        ...context,
        messages: [...context.messages],
      },
      this.createLoopConfig(() => turnState, () => {}),
      (event) => this.handleAgentEvent(event, abortController.signal),
      abortController.signal,
      this.createStreamFn(() => turnState)
    );

    const lastAssistant = [...newMessages]
      .reverse()
      .find((m) => m.role === "assistant") as AssistantMessage | undefined;

    if (!lastAssistant) {
      throw new AgentHarnessError(
        "unknown",
        "Continue completed without an assistant message"
      );
    }
    return lastAssistant;
  } catch (error) {
    this.phase = "idle";
    throw normalizeHarnessError(error, "unknown");
  } finally {
    finishRunPromise();
  }
}
```

**Step 2: Run test to verify it passes**

Run: `cd packages/agent && npx vitest run src/__tests__/harness/agent-harness-continue.test.ts`
Expected: PASS

**Step 3: Verify full suite**

Run: `cd packages/agent && nub run typecheck && nub run test`
Expected: PASS (all tests green)

**Step 4: Commit**

```bash
git add packages/agent/src/types.ts packages/agent/src/harness/agent-harness.ts packages/agent/src/__tests__/harness/agent-harness-continue.test.ts
git commit -m "feat(agent): add auto_retry events + harness.continue()

- auto_retry_start/auto_retry_end AgentEvent variants for the retry loop
- harness.continue() re-enters the loop from current session state
  (used by server retry after rolling back the failed assistant message)"
```

---

## Phase 4 — Implement retry loop in server WS runner ✓ DONE (`0c3b61f`)

> The server's `runPrompt()` wraps `harness.prompt()` in a retry loop. After a failed turn, it checks `isRetryableAssistantError`, emits retry events, rolls back the session leaf, sleeps with exponential backoff, and calls `harness.continue()`.

### Task 4.1: Add `base_delay_ms` to DEFAULT_SETTINGS

**Files:**
- Modify: `apps/server/src/agent/runner.ts:151-158`

**Step 1: Add the setting**

```typescript
const DEFAULT_SETTINGS: Record<string, string> = {
  auto_compaction: "false",
  auto_retry: "true",
  base_delay_ms: "2000",
  follow_up_mode: "all",
  max_retries: "3",
  steering_mode: "all",
  thinking_level: "off",
};
```

### Task 4.2: Write failing test for the retry loop

**Files:**
- Create: `apps/server/src/__tests__/retry-runner.test.ts`

**Step 1: Write the failing test**

The test needs to:
1. Create a harness mock where `prompt()` returns an error message on first call, success on `continue()`
2. Capture emitted events
3. Verify `auto_retry_start` is emitted with correct fields
4. Verify `auto_retry_end` is emitted with `success: true`
5. Verify the sleep/backoff happened
6. Verify `harness.continue()` was called

Alternatively (simpler), test the retry helper function directly:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@sakti-code/llm";
import { isRetryableAssistantError } from "@sakti-code/llm";

// The retry helper will be extracted as a testable function.
import { shouldRetry } from "../agent/retry-loop.ts";

describe("shouldRetry", () => {
  it("returns false when auto_retry is disabled", () => {
    const result = shouldRetry({
      message: errorMsg("429 rate limited"),
      attempt: 0,
      maxRetries: 3,
      autoRetryEnabled: false,
    });
    expect(result).toBe(false);
  });

  it("returns false when error is not retryable", () => {
    const result = shouldRetry({
      message: errorMsg("insufficient_quota"),
      attempt: 0,
      maxRetries: 3,
      autoRetryEnabled: true,
    });
    expect(result).toBe(false);
  });

  it("returns false when attempt budget is exhausted", () => {
    const result = shouldRetry({
      message: errorMsg("429 rate limited"),
      attempt: 3,
      maxRetries: 3,
      autoRetryEnabled: true,
    });
    expect(result).toBe(false);
  });

  it("returns true when error is retryable and budget remains", () => {
    const result = shouldRetry({
      message: errorMsg("429 rate limited"),
      attempt: 0,
      maxRetries: 3,
      autoRetryEnabled: true,
    });
    expect(result).toBe(true);
  });
});

// Helper
function errorMsg(text: string): AssistantMessage { ... }
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/__tests__/retry-runner.test.ts`
Expected: FAIL — module not found.

### Task 4.3: Implement the retry helper + loop

**Files:**
- Create: `apps/server/src/agent/retry-loop.ts` — pure helper (shouldRetry, computeDelay)
- Modify: `apps/server/src/agent/runner.ts` — integrate retry loop into `runPrompt()`

**Step 1: Implement the helper (`retry-loop.ts`)**

```typescript
import { isRetryableAssistantError } from "@sakti-code/llm";
import type { AssistantMessage } from "@sakti-code/llm";

/** Inputs for the retry decision. */
export interface RetryDecisionInput {
  /** The failed assistant message from the just-completed turn. */
  message: AssistantMessage;
  /** Current attempt count (0 = first failure, before any retry). */
  attempt: number;
  /** Max retry attempts from settings. */
  maxRetries: number;
  /** Whether auto-retry is enabled in settings. */
  autoRetryEnabled: boolean;
}

/**
 * Decide whether a failed turn should be retried.
 *
 * Returns true when ALL conditions hold:
 * - auto_retry is enabled in settings
 * - the error is classified as retryable (transient)
 * - the attempt budget is not exhausted
 */
export function shouldRetry(input: RetryDecisionInput): boolean {
  if (!input.autoRetryEnabled) {
    return false;
  }
  if (input.attempt >= input.maxRetries) {
    return false;
  }
  return isRetryableAssistantError(input.message);
}

/**
 * Compute the exponential backoff delay for a retry attempt.
 *
 * @param attempt - 1-based attempt number (first retry = 1)
 * @param baseDelayMs - base delay from settings (default 2000)
 * @returns delay in milliseconds: baseDelayMs * 2^(attempt-1)
 */
export function computeRetryDelay(
  attempt: number,
  baseDelayMs: number
): number {
  return baseDelayMs * 2 ** (attempt - 1);
}

/** Settings for the retry loop. */
export interface RetrySettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
}

/** Parse retry settings from the session settings map. */
export function parseRetrySettings(
  settings: Record<string, string>
): RetrySettings {
  return {
    enabled: settings.auto_retry === "true",
    baseDelayMs: Number.parseInt(settings.base_delay_ms ?? "2000", 10),
    maxRetries: Number.parseInt(settings.max_retries ?? "3", 10),
  };
}
```

**Step 2: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/__tests__/retry-runner.test.ts`
Expected: PASS

### Task 4.4: Integrate retry loop into runPrompt()

**Files:**
- Modify: `apps/server/src/agent/runner.ts:194-261` (the `runPrompt` function)

**Step 1: Add the retry loop**

After the existing `harness.prompt(message)` call, add retry logic:

```typescript
// ── Retry loop (application-level, with UI visibility) ───────────
const retrySettings = parseRetrySettings(settings);
let lastMessage = await harness.prompt(message);
let retryAttempt = 0;

while (shouldRetry({ message: lastMessage, attempt: retryAttempt, ...retrySettings })) {
  retryAttempt++;
  const delayMs = computeRetryDelay(retryAttempt, retrySettings.baseDelayMs);

  // Emit retry start event (UI shows "Retrying in Xs… (attempt N/M)")
  eventCallback({
    attempt: retryAttempt,
    delayMs,
    errorMessage: lastMessage.errorMessage ?? "Unknown error",
    maxAttempts: retrySettings.maxRetries,
    type: "auto_retry_start",
  });

  // Roll back session leaf past the failed assistant message,
  // so harness.continue() sees the user message as the last entry.
  const branch = await sessionInstance.getBranch();
  const lastEntry = branch[branch.length - 1];
  if (lastEntry && lastEntry.parentId) {
    await sessionInstance.getStorage().setLeafId(lastEntry.parentId);
  }

  // Sleep with exponential backoff (abortable via the harness abort signal)
  await sleep(delayMs);

  // Re-run the turn
  lastMessage = await harness.continue();
}

// Emit retry end event
if (retryAttempt > 0) {
  const success = lastMessage.stopReason !== "error";
  eventCallback({
    attempt: retryAttempt,
    ...(success ? {} : { finalError: lastMessage.errorMessage ?? "Unknown error" }),
    success,
    type: "auto_retry_end",
  });
}
```

**Key changes to `runPrompt()`:**
1. Capture the return value of `harness.prompt(message)` (it returns `AssistantMessage`).
2. Change `harness.prompt(message)` call to `await` instead of fire-and-forget.
3. The existing `harness.subscribe(callback)` stays — events still flow during each attempt.
4. Add a `sleep()` helper (simple `new Promise(r => setTimeout(r, ms))` with abort signal support).

**Step 2: Write integration test**

Test the full retry flow:
- Mock harness where `prompt()` returns error message (429), `continue()` returns success
- Verify `auto_retry_start` then `auto_retry_end { success: true }` are emitted
- Verify `setLeafId` was called to roll back

**Step 3: Verify**

Run: `cd apps/server && nub run typecheck && nub run test`
Expected: PASS (existing 213+ tests + new retry tests)

**Step 4: Commit**

```bash
git add apps/server/src/agent/retry-loop.ts apps/server/src/agent/runner.ts apps/server/src/__tests__/retry-runner.test.ts
git commit -m "feat(server): application-level retry with UI events

After a failed LLM turn, the server's WS runner classifies the error
(isRetryableAssistantError), emits auto_retry_start/auto_retry_end
events, rolls back the session leaf, and re-runs via harness.continue()
with exponential backoff (2s, 4s, 8s — matching pi's defaults).

Settings: auto_retry (default true), max_retries (default 3),
base_delay_ms (default 2000) from session settings."
```

---

## Phase 5 — UI: handle retry events ✓ DONE (`3136079`)

> The desktop UI handles `auto_retry_start` / `auto_retry_end` in the event reducer and shows a retry banner.

### Task 5.1: Add retry state to event reducer

**Files:**
- Modify: `apps/desktop/src/stores/session/event-reducer.ts`
- Modify: `apps/desktop/src/stores/session/types.ts` (or wherever the session state type lives)

**Step 1: Write failing test**

Add test cases to the existing event-reducer test file:

```typescript
describe("event-reducer — auto_retry", () => {
  it("sets retry state on auto_retry_start", () => {
    const state = reducer(initialState, {
      attempt: 2,
      delayMs: 4000,
      errorMessage: "Rate limited (429)",
      maxAttempts: 3,
      type: "auto_retry_start",
    });
    expect(state.retry).toEqual({
      attempt: 2,
      delayMs: 4000,
      errorMessage: "Rate limited (429)",
      maxAttempts: 3,
    });
  });

  it("clears retry state on auto_retry_end", () => {
    const state = reducer(
      { ...initialState, retry: { attempt: 2, delayMs: 4000, errorMessage: "err", maxAttempts: 3 } },
      { attempt: 2, success: true, type: "auto_retry_end" }
    );
    expect(state.retry).toBeUndefined();
  });

  it("clears retry state on auto_retry_end with finalError", () => {
    const state = reducer(
      { ...initialState, retry: { attempt: 3, delayMs: 8000, errorMessage: "err", maxAttempts: 3 } },
      { attempt: 3, finalError: "Still rate limited", success: false, type: "auto_retry_end" }
    );
    expect(state.retry).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/session/event-reducer.test.ts -t "auto_retry"`
Expected: FAIL — case not handled.

**Step 3: Implement the reducer cases**

Add `retry?: RetryState` to the session state type:

```typescript
export interface RetryState {
  attempt: number;
  delayMs: number;
  errorMessage: string;
  maxAttempts: number;
}
```

Add to the reducer:

```typescript
case "auto_retry_start":
  return {
    ...state,
    retry: {
      attempt: action.attempt,
      delayMs: action.delayMs,
      errorMessage: action.errorMessage,
      maxAttempts: action.maxAttempts,
    },
  };
case "auto_retry_end":
  return { ...state, retry: undefined };
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/session/event-reducer.test.ts -t "auto_retry"`
Expected: PASS

### Task 5.2: Create retry banner component

**Files:**
- Create: `apps/desktop/src/components/session/retry-banner.tsx`

**Step 1: Implement the component**

A SolidJS component that reads `retry` from the session store and shows:
- Error message: "Rate limited (429)"
- Attempt counter: "Attempt 2 of 3"
- Delay: "Retrying in 4s…"
- Cancel button (sends `{ type: "abort" }` via WS)

```tsx
import { Show } from "solid-js";
import { useSessionStore } from "../../stores/session";

export function RetryBanner() {
  const store = useSessionStore();
  return (
    <Show when={store.retry}>
      {(retry) => (
        <div class="retry-banner">
          <span class="retry-banner__error">{retry().errorMessage}</span>
          <span class="retry-banner__attempt">
            Attempt {retry().attempt} of {retry().maxAttempts}
          </span>
          <span class="retry-banner__delay">
            Retrying in {retry().delayMs / 1000}s…
          </span>
          <button
            class="retry-banner__cancel"
            onClick={() => store.abort()}
          >
            Cancel
          </button>
        </div>
      )}
    </Show>
  );
}
```

**Step 2: Mount it in the session view**

Add `<RetryBanner />` to the session view, above or below the message list.

**Step 3: Verify**

Run: `cd apps/desktop && nub run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/stores/session/event-reducer.ts apps/desktop/src/stores/session/types.ts apps/desktop/src/stores/session/event-reducer.test.ts apps/desktop/src/components/session/retry-banner.tsx
git commit -m "feat(desktop): retry banner UI for auto-retry events

Shows error message, attempt count, delay, and cancel button when
the server emits auto_retry_start. Clears on auto_retry_end."
```

---

## Phase 6 — End-to-end verification ✓ DONE

> **Result:** 6/6 packages typecheck clean. 53 new tests added (llm +26, agent +4, server +17, desktop +6). All green; the only failures are the pre-existing 4 node-pty terminal tests + 1 compaction test (needs a live LLM key, exercisable via `SAKTI_SMOKE=1`).

### Task 6.1: Full workspace typecheck + tests

Run:
```bash
nub run typecheck           # all 6 packages
cd packages/llm && nub run test
cd packages/agent && nub run test
cd apps/server && nub run test
cd apps/desktop && nub run test
```

Expected: All pass (same pre-existing failures as before, zero regressions).

### Task 6.2: Smoke test with real provider

Test the retry flow against a real provider that rate-limits:

```bash
SAKTI_SMOKE=1 OPENCODE_API_KEY=<key> \
  npx vitest run src/__tests__/compaction.test.ts -t "summarizes and persists"
```

Or manually trigger a rate limit by sending rapid requests and observing the retry banner in the desktop UI.

### Task 6.3: Final commit + plan update

Update this plan with phase markers. Tag the final commit.

---

## Risk register

- **Session leaf rollback correctness** — `setLeafId(parentId)` must correctly orphan the failed entry without corrupting the tree. The session tree handles branching naturally (forking uses the same mechanism), so this is well-tested infrastructure.
- **Event ordering** — `auto_retry_start` must arrive before the retry's `agent_start` event, and `auto_retry_end` must arrive after the final `agent_end`. The server runner emits them synchronously between turns, so ordering is guaranteed.
- **Abort during retry sleep** — the existing `abortRun()` mechanism calls `harness.abort()`. During the retry sleep, we need the abort signal to interrupt the `setTimeout`. The sleep helper should accept the harness's `AbortSignal`.
- **`harness.continue()` correctness** — must rebuild context from session after leaf rollback. The existing `runAgentLoopContinue()` already validates the last message role. The harness's `continue()` reuses the same turn-state/config logic as `prompt()`.

## Out of scope

- Retry for non-streaming calls (compaction) — compaction already catches errors and returns `finishReason: "error"`.
- Configurable retry per-provider — global settings suffice for now.
- Live countdown timer in the UI — static "Retrying in Xs" text is sufficient.
- Retry of mid-stream errors — only pre-token connection errors retry (once tokens flow, the turn commits).
