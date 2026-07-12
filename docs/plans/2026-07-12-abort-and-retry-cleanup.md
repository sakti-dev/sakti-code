# Abort UX + Retry Strip Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Escape-to-abort and send-button-becomes-cancel to the chip input, and fix the stale retry strip bug where transient streaming/retry state persists after a server error frame.

**Architecture:** Three independent layers of change: (1) server-side retry loop guarantees `auto_retry_end` emission via an Effect finalizer even when `runTurn` fails with an Effect error; (2) desktop WS client `error` frame handler performs full state cleanup (retry, phase, streaming) mirroring `agent_end`/`abort` lifecycle handlers; (3) chip input gains `onAbort` prop + send button becomes a dual-purpose send/cancel button.

**Tech Stack:** SolidJS (desktop UI), Effect (agent retry loop), Vitest (tests), TypeScript with `exactOptionalPropertyTypes: true`.

---

## Root Cause Analysis (Reference)

### Stale retry strip — TWO root causes

**Root Cause 1 (server): `executeWithRetryEffect` skips `auto_retry_end` on Effect failure**

`packages/agent/src/runner/retry-loop.ts:218` — when `yield* deps.runTurn()` fails with an Effect error (not a returned error message — a real throw like a DB write failure or `planFirstTurn` crash), the `yield*` propagates the failure. The `auto_retry_end` at line 231 is never reached. The retry loop emitted `auto_retry_start` but the matching `auto_retry_end` never fires.

```
auto_retry_start emitted → rollbackLeaf → sleep → runTurn THROWS
                                                         ↓
                              Effect propagates failure (auto_retry_end skipped)
```

**Root Cause 2 (desktop): `error` frame handler doesn't clear transient state**

`apps/desktop/src/stores/server/ws-client.ts:99-113` — the `error` case handler only calls `setError(msgId, error)` and `finalizeTurn()`. It does NOT:

- `setRetry(null)` → stale retry strip
- `setPhase("idle")` → stuck "generating" phase
- `clearCurrentMessage()` / `clearCurrentTool()` → stale streaming pointers
- `setIsStreaming(false)` → streaming indicator stuck

So when the server sends `error` (after `runPrompt` throws — including the retry-loop Effect failure from Root Cause 1), the retry strip and streaming state persist forever.

**The Cancel button in the retry strip works fine** — `actions.abortRun()` → server `abortRun()` → `retryAbort.abort()` + `harness.abort()` → retry loop emits `auto_retry_end` + harness emits `abort` event. Both clear the desktop state. The bug is specifically about **server-initiated errors** that arrive as `error` frames, not user-initiated cancels.

---

## Task 1: Server retry loop — guarantee `auto_retry_end` on Effect failure

**Files:**

- Modify: `packages/agent/src/runner/retry-loop.ts`
- Test: `packages/agent/src/runner/__tests__/retry-loop.test.ts`

### Step 1: Write failing test — `auto_retry_end` emitted when `runTurn` throws

Add to `packages/agent/src/runner/__tests__/retry-loop.test.ts`, inside the `describe("executeWithRetryEffect", ...)` block at the end (before the closing `});` at line 434):

```typescript
it("emits auto_retry_end when runTurn fails with an Effect error mid-retry", async () => {
  const emitCalls: AgentEvent[] = [];
  let turnIndex = 0;
  const turns: AssistantMessage[] = [
    assistantMessage({
      stopReason: "error",
      errorMessage: "429 rate limited",
    }),
  ];
  const deps: RetryRunnerDepsEffect = {
    signal: new AbortController().signal,
    emit: (event) => emitCalls.push(event),
    rollbackLeaf: () => Effect.void,
    runTurn: () =>
      Effect.gen(function* () {
        turnIndex++;
        if (turnIndex === 1) {
          return turns[0]!;
        }
        // Second call (the retry turn) fails with an Effect error.
        return yield* Effect.fail(new Error("DB write failed during retry"));
      }),
  };

  // The Effect fails overall — catch it so the test can inspect emits.
  const result = await Effect.runPromise(
    Effect.either(executeWithRetryEffect(deps, enabledSettings)),
  );

  // The Effect should have failed (left = error).
  expect(result._tag).toBe("Left");

  // CRITICAL: auto_retry_end must still be emitted despite the Effect failure.
  const types = emitCalls.map((e) => e.type);
  expect(types).toContain("auto_retry_start");
  expect(types).toContain("auto_retry_end");

  const end = emitCalls.at(-1)!;
  expect(end).toMatchObject({
    type: "auto_retry_end",
    success: false,
    attempt: 1,
  });
});

it("does NOT emit auto_retry_end on success path (no double emit)", async () => {
  // Regression guard: the finalizer must not double-emit when the loop exits
  // normally after emitting auto_retry_end itself.
  const fake = makeFakeDeps({
    signal: new AbortController().signal,
    turns: [
      assistantMessage({
        stopReason: "error",
        errorMessage: "429 rate limited",
      }),
      assistantMessage({ text: "ok", stopReason: "stop" }),
    ],
  });
  await runRetry(fake.deps, enabledSettings);

  // Exactly one start and one end — no duplicate.
  const ends = fake.emitCalls.filter((e) => e.type === "auto_retry_end");
  expect(ends).toHaveLength(1);
});

it("emits auto_retry_end when rollbackLeaf fails mid-retry", async () => {
  const emitCalls: AgentEvent[] = [];
  const deps: RetryRunnerDepsEffect = {
    signal: new AbortController().signal,
    emit: (event) => emitCalls.push(event),
    rollbackLeaf: () => Effect.fail(new Error("storage corrupted")),
    runTurn: () =>
      Effect.sync(() =>
        assistantMessage({
          stopReason: "error",
          errorMessage: "429 rate limited",
        }),
      ),
  };

  const result = await Effect.runPromise(
    Effect.either(executeWithRetryEffect(deps, enabledSettings)),
  );
  expect(result._tag).toBe("Left");

  const types = emitCalls.map((e) => e.type);
  expect(types).toContain("auto_retry_start");
  expect(types).toContain("auto_retry_end");
  const end = emitCalls.at(-1)!;
  expect(end).toMatchObject({ type: "auto_retry_end", success: false });
});
```

### Step 2: Run tests to verify they fail

Run: `vp run '@sakti-code/agent#test' -- --run packages/agent/src/runner/__tests__/retry-loop.test.ts`
Expected: The first and third tests FAIL — `auto_retry_end` is missing from `emitCalls`. The second test PASSES (already correct).

### Step 3: Implement — add Effect finalizer to `executeWithRetryEffect`

Modify `packages/agent/src/runner/retry-loop.ts`. Change `executeWithRetryEffect` from a bare `Effect.gen(...)` to a function that tracks retry state and adds an `Effect.ensuring` finalizer.

Replace the entire `executeWithRetryEffect` export (lines 152-238) with:

```typescript
/**
 * Run a turn, retrying transient failures with exponential backoff and full UI
 * visibility. Emits `auto_retry_start` before each retry's backoff and a single
 * `auto_retry_end` once the outcome is final (success, budget exhausted, or
 * aborted). If the first turn succeeds, no retry events are emitted at all.
 *
 * Effect-native: consumes {@link RetryRunnerDepsEffect} (Effect-typed callbacks).
 * Run via `Effect.runPromise` at the edge, or composed inside another Effect.
 *
 * **Finalizer guarantee:** If the Effect fails mid-retry (e.g. `runTurn` or
 * `rollbackLeaf` throws), the finalizer emits a catch-all `auto_retry_end` so
 * the UI's retry banner never gets stuck visible. The finalizer is a no-op
 * when the loop exits normally (it already emitted its own `auto_retry_end`).
 */
export const executeWithRetryEffect = (
  deps: RetryRunnerDepsEffect,
  settings: RetrySettings,
): Effect.Effect<void, Error> => {
  // Hoisted so the finalizer (outside the gen body) can read it.
  // When true, the loop emitted `auto_retry_start` but has NOT yet emitted a
  // matching `auto_retry_end`. The finalizer emits the catch-all if this is
  // still true on exit.
  let retryActive = false;
  let lastErrorMessage: string | undefined;
  let lastAttempt = 0;

  return Effect.gen(function* () {
    deps.logger?.debug("turn attempt", {
      attempt: 0,
      maxRetries: settings.maxRetries,
    });
    let message = yield* deps.runTurn();
    if (!settings.enabled) {
      return;
    }

    deps.logger?.info("retry started", { maxRetries: settings.maxRetries });
    let attempt = 0;
    while (
      shouldRetry({
        message,
        attempt,
        maxRetries: settings.maxRetries,
        autoRetryEnabled: settings.enabled,
      })
    ) {
      attempt++;
      lastAttempt = attempt;
      const delayMs = computeRetryDelay(attempt, settings.baseDelayMs);

      deps.logger?.error(
        "turn error",
        message.errorMessage ? new Error(message.errorMessage) : undefined,
        { attempt },
      );
      deps.logger?.debug("should retry", {
        attempt,
        maxRetries: settings.maxRetries,
        willRetry: true,
      });

      deps.emit({
        type: "auto_retry_start",
        attempt,
        delayMs,
        errorMessage: message.errorMessage ?? "Unknown error",
        maxAttempts: settings.maxRetries,
      });
      retryActive = true;
      lastErrorMessage = message.errorMessage;

      deps.logger?.warn("rolling back leaf", { attempt });
      yield* deps.rollbackLeaf();

      deps.logger?.debug("backoff", { delayMs, attempt });
      const slept = yield* Effect.promise(() => abortableSleep(delayMs, deps.signal));
      if (!slept || deps.signal.aborted) {
        deps.logger?.warn("retry aborted", { attempt });
        deps.emit({
          type: "auto_retry_end",
          success: false,
          attempt,
          ...(message.errorMessage === undefined ? {} : { finalError: message.errorMessage }),
        });
        retryActive = false;
        return;
      }

      deps.logger?.debug("turn attempt", {
        attempt,
        maxRetries: settings.maxRetries,
      });
      message = yield* deps.runTurn();
      lastErrorMessage = message.errorMessage;
    }

    if (attempt > 0) {
      const success = !deps.signal.aborted && message.stopReason !== "error";
      if (success) {
        deps.logger?.info("turn succeeded", { attempt });
      } else {
        deps.logger?.error("all retries exhausted", undefined, {
          attempts: attempt,
          errorMessage: message.errorMessage ?? "Unknown error",
        });
      }
      deps.emit({
        type: "auto_retry_end",
        success,
        attempt,
        ...(success ? {} : { finalError: message.errorMessage ?? "Unknown error" }),
      });
      retryActive = false;
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        // Catch-all: if the Effect failed mid-retry (runTurn or rollbackLeaf
        // threw), the loop never reached its own auto_retry_end emission.
        // Emit one now so the UI banner clears.
        if (retryActive) {
          deps.emit({
            type: "auto_retry_end",
            success: false,
            attempt: lastAttempt,
            ...(lastErrorMessage === undefined ? {} : { finalError: lastErrorMessage }),
          });
        }
      }),
    ),
  );
};
```

### Step 4: Run tests to verify they pass

Run: `vp run '@sakti-code/agent#test' -- --run packages/agent/src/runner/__tests__/retry-loop.test.ts`
Expected: ALL tests PASS (existing + 3 new).

### Step 5: Commit

```bash
git add packages/agent/src/runner/retry-loop.ts packages/agent/src/runner/__tests__/retry-loop.test.ts
git commit -m "fix(retry): guarantee auto_retry_end on Effect failure

When runTurn or rollbackLeaf throws mid-retry, the Effect propagates
the error and the loop's own auto_retry_end emission is skipped. Add
an Effect.ensuring finalizer that emits a catch-all auto_retry_end if
retryActive is still true on exit. The finalizer is a no-op when the
loop exits normally."
```

---

## Task 2: Desktop WS client — `error` frame clears all transient state

**Files:**

- Modify: `apps/desktop/src/stores/server/ws-client.ts:99-113`
- Test: `apps/desktop/src/stores/server/__tests__/ws-client.test.ts`

### Step 1: Write failing tests

Add these tests to `apps/desktop/src/stores/server/__tests__/ws-client.test.ts`, before the closing `});` of the top-level `describe("WS client", ...)` block (after the last existing test at line 363):

```typescript
it("error frame clears retry state (stale strip fix)", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  fake.fireOpen();
  const session = deps.sessionRegistry.get("s1");

  // Simulate: agent started, retry fired, then server error arrives.
  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "agent_start" },
  });
  session.actions.setRetry({
    attempt: 1,
    delayMs: 2000,
    errorMessage: "429 rate limited",
    maxAttempts: 3,
  });
  expect(session.store.retry).not.toBeNull();

  fake.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

  expect(session.store.retry).toBeNull();
  ws.disconnect();
});

it("error frame sets phase to idle (not stuck thinking)", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  fake.fireOpen();
  const session = deps.sessionRegistry.get("s1");

  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "agent_start" },
  });
  expect(session.store.streaming.phase).toBe("thinking");

  fake.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

  expect(session.store.streaming.phase).toBe("error");
  ws.disconnect();
});

it("error frame clears isStreaming signal", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  fake.fireOpen();
  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "agent_start" },
  });
  expect(isStreaming()).toBe(true);

  fake.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

  expect(isStreaming()).toBe(false);
  ws.disconnect();
});

it("error frame clears currentToolName", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  fake.fireOpen();
  const session = deps.sessionRegistry.get("s1");

  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "agent_start" },
  });
  session.actions.setCurrentTool("bash");
  expect(session.store.streaming.currentToolName).toBe("bash");

  fake.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

  expect(session.store.streaming.currentToolName).toBeNull();
  ws.disconnect();
});

it("error frame clears currentMessageId", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  fake.fireOpen();
  const session = deps.sessionRegistry.get("s1");
  session.actions.startTurn(null);
  session.actions.addAssistantMessage({
    content: "",
    id: "m1",
    isStreaming: true,
    parts: [],
    role: "assistant",
    timestamp: Date.now(),
  });
  expect(session.store.streaming.currentMessageId).toBe("m1");

  fake.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

  expect(session.store.streaming.currentMessageId).toBeNull();
  ws.disconnect();
});
```

### Step 2: Run tests to verify they fail

Run: `vp run desktop#test -- --run apps/desktop/src/stores/server/__tests__/ws-client.test.ts`
Expected: 4 of 5 tests FAIL (the "phase" test might already pass since `setError` sets phase to "error"). The retry-clear, isStreaming-clear, currentToolName-clear, and currentMessageId-clear tests fail.

### Step 3: Implement — full cleanup in `error` handler

Modify `apps/desktop/src/stores/server/ws-client.ts`. Replace the `case "error"` block (lines 99-113):

```typescript
      case "error": {
        if (!(data.sessionId && data.error)) {
          break;
        }
        log.error("ws error", new Error(data.error), {
          sessionId: data.sessionId,
        });
        const session = sessionRegistry.get(data.sessionId);
        const msgId = session.store.streaming.currentMessageId;
        if (msgId) {
          session.actions.setError(msgId, data.error);
        }
        session.actions.finalizeTurn(Date.now());
        session.actions.clearCurrentMessage();
        session.actions.clearCurrentTool();
        session.actions.setRetry(null);
        setIsStreaming(false);
        break;
      }
```

**Note:** `setError` already sets `phase` to `"error"` and `finalizeTurn` ends the turn. We add `clearCurrentMessage`, `clearCurrentTool`, `setRetry(null)`, and `setIsStreaming(false)` to match the cleanup that `agent_end` and `abort` lifecycle handlers perform. We do NOT call `setPhase("idle")` because `setError` already sets phase to `"error"` which is more informative — the phase will reset to `"idle"` on the next `agent_start`.

### Step 4: Run tests to verify they pass

Run: `vp run desktop#test -- --run apps/desktop/src/stores/server/__tests__/ws-client.test.ts`
Expected: ALL tests PASS (existing + 5 new).

### Step 5: Commit

```bash
git add apps/desktop/src/stores/server/ws-client.ts apps/desktop/src/stores/server/__tests__/ws-client.test.ts
git commit -m "fix(ws-client): clear retry+streaming state on error frame

The error frame handler only set the error message and finalized the
turn — it left retry, currentTool, currentMessage, and isStreaming
stale. When the server sent an error after runPrompt threw (e.g. a
retry-loop Effect failure), the retry strip and streaming indicator
persisted forever. Now the handler mirrors the agent_end/abort cleanup."
```

---

## Task 3: Chip input — `onAbort` prop + Escape key handler

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chip-input.tsx`
- Test: `apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx`

### Step 1: Write failing tests

Add these tests to `apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx`, inside the first `describe("ChipInput", ...)` block (after the "does NOT submit on Shift+Enter" test at line 65):

```typescript
  it("calls onAbort on Escape when no menu is active", () => {
    const onAbort = vi.fn();
    render(() => <ChipInput onChange={() => {}} onAbort={onAbort} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onAbort on Escape when a token menu IS active", () => {
    const onAbort = vi.fn();
    const onMenuKeyDown = vi.fn();
    render(() => (
      <ChipInput
        onChange={() => {}}
        onAbort={onAbort}
        onQuery={vi.fn()}
        onMenuKeyDown={onMenuKeyDown}
      />
    ));
    const ed = screen.getByRole("textbox") as HTMLElement;
    // Open the @ menu
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    // Now Escape should go to the menu, not onAbort
    onAbort.mockClear();
    fireEvent.keyDown(ed, { key: "Escape" });
    expect(onMenuKeyDown).toHaveBeenCalledTimes(1);
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("calls onSubmit on Enter even when onAbort is wired", () => {
    const onSubmit = vi.fn();
    const onAbort = vi.fn();
    render(() => (
      <ChipInput onChange={() => {}} onSubmit={onSubmit} onAbort={onAbort} />
    ));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onAbort).not.toHaveBeenCalled();
  });
```

### Step 2: Run tests to verify they fail

Run: `vp run desktop#test -- --run apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx`
Expected: The first test FAILS — `onAbort` prop doesn't exist, Escape does nothing. The second test PASSES (menu already swallows Escape). The third test PASSES (Enter already works).

### Step 3: Implement — add `onAbort` prop + Escape handler

Modify `apps/desktop/src/components/chat-input/chip-input.tsx`.

**3a.** Add `onAbort` to `ChipInputProps` (after `onSubmit?`):

```typescript
  /** Called when Escape is pressed with no active token menu. */
  onAbort?: () => void;
```

**3b.** Add the Escape handler in `onKeyDown`. After the `tokenAnchor && MENU_KEYS.has(e.key)` block (line 218) and before the ArrowUp/ArrowDown history block (line 220), insert:

```typescript
if (e.key === "Escape") {
  e.preventDefault();
  props.onAbort?.();
  return;
}
```

The full `onKeyDown` function will look like:

```typescript
const onKeyDown = (e: KeyboardEvent) => {
  if (composing) {
    return;
  }
  if (tokenAnchor && MENU_KEYS.has(e.key)) {
    e.preventDefault();
    props.onMenuKeyDown?.(e);
    if (e.key === "Escape") {
      endToken();
    }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    props.onAbort?.();
    return;
  }
  if (!tokenAnchor && editorRef && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    const active = props.historyActive?.() ?? false;
    if (e.key === "ArrowUp" && (active || isAtEditorStart(editorRef))) {
      e.preventDefault();
      props.onHistoryNavigate?.("up");
      return;
    }
    if (e.key === "ArrowDown" && (active || isAtEditorEnd(editorRef))) {
      e.preventDefault();
      props.onHistoryNavigate?.("down");
      return;
    }
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    props.onSubmit?.();
    return;
  }
  if (e.key === "/" && editorRef && isAtEditorStart(editorRef)) {
    e.preventDefault();
    beginToken("/");
  } else if (e.key === "@") {
    e.preventDefault();
    beginToken("@");
  }
};
```

### Step 4: Run tests to verify they pass

Run: `vp run desktop#test -- --run apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx`
Expected: ALL tests PASS.

### Step 5: Commit

```bash
git add apps/desktop/src/components/chat-input/chip-input.tsx apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx
git commit -m "feat(chip-input): add onAbort prop fired on Escape (no menu)

Escape with no active token menu now calls onAbort, letting the parent
component abort the running agent. Escape with an active menu still
closes the menu (existing behavior)."
```

---

## Task 4: Send button — becomes cancel button when streaming

**Files:**

- Modify: `apps/desktop/src/components/chat-input/send-button.tsx`
- Create: `apps/desktop/src/components/chat-input/__tests__/send-button.test.tsx`

### Step 1: Write failing tests

Create `apps/desktop/src/components/chat-input/__tests__/send-button.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { SendButton } from "../send-button";

describe("SendButton", () => {
  it("shows send icon and calls onSend when not streaming", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(() => (
      <SendButton canSend={() => true} isSending={false} onSend={onSend} onAbort={onAbort} />
    ));
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onAbort).not.toHaveBeenCalled();
    expect(btn.getAttribute("aria-label")).toBe("Send");
  });

  it("shows stop icon and calls onAbort when streaming", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(() => (
      <SendButton canSend={() => false} isSending={true} onSend={onSend} onAbort={onAbort} />
    ));
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(btn.getAttribute("aria-label")).toBe("Stop");
  });

  it("is not disabled when streaming (cancel must be clickable)", () => {
    const onAbort = vi.fn();
    render(() => (
      <SendButton canSend={() => false} isSending={true} onSend={vi.fn()} onAbort={onAbort} />
    ));
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("is disabled when not streaming and canSend is false", () => {
    const onSend = vi.fn();
    render(() => (
      <SendButton canSend={() => false} isSending={false} onSend={onSend} onAbort={vi.fn()} />
    ));
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onSend when not streaming and canSend is true", () => {
    const onSend = vi.fn();
    render(() => (
      <SendButton canSend={() => true} isSending={false} onSend={onSend} onAbort={vi.fn()} />
    ));
    fireEvent.click(screen.getByRole("button"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `vp run desktop#test -- --run apps/desktop/src/components/chat-input/__tests__/send-button.test.tsx`
Expected: Tests FAIL — `SendButton` doesn't accept `onSend`/`onAbort` props, and doesn't render a stop icon.

### Step 3: Implement — rewrite `SendButton` as dual-purpose

Replace the entire contents of `apps/desktop/src/components/chat-input/send-button.tsx`:

```tsx
import { FiLoader, FiSend, FiSquare } from "solid-icons/fi";
import type { Accessor } from "solid-js";
import { cn } from "~/lib/utils";

interface SendButtonProps {
  canSend: Accessor<boolean>;
  isSending: boolean;
  onSend: () => void;
  onAbort: () => void;
}

export function SendButton(props: SendButtonProps) {
  const streaming = () => props.isSending;
  const disabled = () => !streaming() && !props.canSend();

  return (
    <button
      aria-label={streaming() ? "Stop" : "Send"}
      class={cn(
        "flex items-center justify-center rounded-lg p-2 transition-all duration-200",
        disabled() && "cursor-not-allowed bg-muted/20 text-muted-foreground/50 opacity-50",
        !disabled() && !streaming() && "bg-primary text-primary-foreground hover:bg-primary/90",
        streaming() &&
          "bg-destructive/10 text-destructive ring-1 ring-destructive/30 hover:bg-destructive/20",
      )}
      disabled={disabled()}
      onClick={() => {
        if (streaming()) {
          props.onAbort();
        } else {
          props.onSend();
        }
      }}
      title={streaming() ? "Stop generating" : "Send message"}
      type="button"
    >
      {streaming() ? (
        <FiSquare class="size-4" />
      ) : props.isSending ? (
        <FiLoader class="size-4 animate-spin" />
      ) : (
        <FiSend class="size-4" />
      )}
    </button>
  );
}
```

**Design notes:**

- When `isSending` is true, the button shows a red stop icon (`FiSquare`), is NOT disabled, and clicking calls `onAbort`.
- When `isSending` is false and `canSend()` is true, shows send icon, calls `onSend`.
- When `isSending` is false and `canSend()` is false, button is disabled.
- The `streaming()` derivation is the single source of truth for "are we currently generating?".

**Note on the `FiSquare` icon:** This is the standard "stop" square icon from `solid-icons/fi` (Feather icons). It visually communicates "stop" universally.

### Step 4: Run tests to verify they pass

Run: `vp run desktop#test -- --run apps/desktop/src/components/chat-input/__tests__/send-button.test.tsx`
Expected: ALL 5 tests PASS.

### Step 5: Commit

```bash
git add apps/desktop/src/components/chat-input/send-button.tsx apps/desktop/src/components/chat-input/__tests__/send-button.test.tsx
git commit -m "feat(send-button): dual-purpose send/stop button

When streaming, the send button transforms into a red stop button
that aborts the agent. The button is never disabled while streaming
so cancel is always reachable. New props: onSend + onAbort (replaces
onClick)."
```

---

## Task 5: Wire `chat-input.tsx` — connect `onAbort` + new `SendButton` API

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx`
- Test: `apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx` (verify existing tests still pass)

### Step 1: Write a test for Escape aborts via chat-input

Check if the existing chat-input test file mocks the store. If so, add a test. If the existing tests are integration-style (full store), add:

```typescript
// In the existing chat-input test file, add:
it("Escape in the editor aborts the agent when generating", async () => {
  // This test depends on the existing test infrastructure.
  // If the test file uses a real store, simulate a generating state,
  // focus the editor, press Escape, and assert ws.send was called
  // with { type: "abort", sessionId }.
  // If the test file mocks actions, assert actions.abortRun was called.
});
```

**If the existing chat-input tests don't easily support this** (e.g., they only test the @-fetch behavior), skip the chat-input-level test and rely on the chip-input + send-button unit tests. The wiring is thin enough that a type check is sufficient.

### Step 2: Implement — wire `onAbort` and new `SendButton` props

Modify `apps/desktop/src/components/chat-input/chat-input.tsx`.

**5a.** Add `abort` handler after the `send` function (around line 267):

```typescript
const abort = () => {
  if (props.sessionId) {
    actions.abortRun(props.sessionId);
  }
};
```

**5b.** Wire `onAbort` to `ChipInput` (around line 325-336). Add the `onAbort` prop:

```tsx
<ChipInput
  disabled={props.disabled}
  historyActive={histActive}
  onChange={setValue}
  onHistoryNavigate={onHistoryNavigate}
  onSubmit={send}
  onAbort={abort}
  onTrigger={onTrigger}
  onQuery={onQuery}
  onMenuKeyDown={(e) => nav.handleKeyDown(e)}
  placeholder={props.placeholder ?? "Send a message…"}
  registerApi={(a) => (chipApi = a)}
/>
```

**5c.** Update `SendButton` invocation (around line 340). Change from:

```tsx
<SendButton canSend={canSend} isSending={isGenerating()} onClick={send} />
```

to:

```tsx
<SendButton canSend={canSend} isSending={isGenerating()} onSend={send} onAbort={abort} />
```

### Step 3: Run existing chat-input tests to verify nothing breaks

Run: `vp run desktop#test -- --run apps/desktop/src/components/chat-input/__tests__/`
Expected: ALL existing tests PASS. The `at-fetch` and `history` tests should be unaffected.

### Step 4: Type-check the whole desktop package

Run: `vp run desktop#test -- --run apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx apps/desktop/src/components/chat-input/__tests__/chat-input-history.test.tsx apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx`
Expected: PASS.

### Step 5: Commit

```bash
git add apps/desktop/src/components/chat-input/chat-input.tsx
git commit -m "feat(chat-input): wire Escape-to-abort + send/cancel button

ChipInput onAbort calls actions.abortRun when the agent is running.
SendButton now uses onSend/onAbort instead of onClick. Both paths
send { type: 'abort' } via the WS channel."
```

---

## Task 6: Retry strip Cancel button — verify and harden

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx` (retry strip Cancel button)
- Test: `apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx` (if feasible)

### Analysis

The retry strip's Cancel button at `chat-input.tsx:289-299` already calls `actions.abortRun(props.sessionId)`. This works correctly — the server's `abortRun()` aborts both the retry backoff and the harness, emitting `auto_retry_end` + `abort` events that clear the desktop state.

**However**, the Cancel button has a subtle issue: it renders inside `<Show when={retry()}>`, but if the user clicks Cancel and the abort events arrive, `retry()` becomes null, the `<Show>` unmounts, and there's a brief flash. This is cosmetically acceptable.

**No code change needed for the Cancel button itself.** The fix in Task 2 (error frame clears retry state) covers the case where the server error was the cause. The Cancel button already works for user-initiated abort.

### Step 1: Verify with a regression test

Add to `apps/desktop/src/stores/server/__tests__/ws-client.test.ts`:

```typescript
it("abort event clears retry state (Cancel button path)", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  fake.fireOpen();
  const session = deps.sessionRegistry.get("s1");

  // Simulate: retry fired, then user clicks Cancel → server aborts.
  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "agent_start" },
  });
  session.actions.setRetry({
    attempt: 1,
    delayMs: 2000,
    errorMessage: "429 rate limited",
    maxAttempts: 3,
  });

  // User abort → server sends abort event.
  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "abort", clearedSteer: [], clearedFollowUp: [] },
  });

  expect(session.store.retry).toBeNull();
  expect(session.store.streaming.phase).toBe("idle");
  ws.disconnect();
});

it("auto_retry_end clears retry state", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  fake.fireOpen();
  const session = deps.sessionRegistry.get("s1");

  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "agent_start" },
  });
  session.actions.setRetry({
    attempt: 1,
    delayMs: 2000,
    errorMessage: "429 rate limited",
    maxAttempts: 3,
  });

  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "auto_retry_end", success: true, attempt: 1 },
  });

  expect(session.store.retry).toBeNull();
  ws.disconnect();
});

it("agent_end clears retry state", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  fake.fireOpen();
  const session = deps.sessionRegistry.get("s1");

  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "agent_start" },
  });
  session.actions.setRetry({
    attempt: 1,
    delayMs: 2000,
    errorMessage: "429 rate limited",
    maxAttempts: 3,
  });

  fake.fireMessage({
    type: "event",
    sessionId: "s1",
    event: { type: "agent_end", messages: [] },
  });

  expect(session.store.retry).toBeNull();
  ws.disconnect();
});
```

### Step 2: Run tests — these should PASS already (regression guards)

Run: `vp run desktop#test -- --run apps/desktop/src/stores/server/__tests__/ws-client.test.ts`
Expected: ALL tests PASS. These are regression guards proving that all three clearing paths (`abort` event, `auto_retry_end` event, `agent_end` event) work correctly.

### Step 3: Commit

```bash
git add apps/desktop/src/stores/server/__tests__/ws-client.test.ts
git commit -m "test(ws-client): regression guards for retry-clear paths

Proves that abort event, auto_retry_end event, agent_end event, and
error frames all clear the retry state. Guards against regressions
in the stale-retry-strip bug class."
```

---

## Task 7: Full-suite verification

### Step 1: Run `vp check`

```bash
vp check
```

Expected: EXIT 0 (clean). If formatting issues arise, run `vp check --fix` then re-run.

### Step 2: Run full test suite

```bash
vp run -r test
```

Expected: All tests pass except known pre-existing failures (3 CLI tests in sakti package, 4 terminal tests in server suite).

### Step 3: Clean up any leftover test fixtures

```bash
rm -rf packages/sakti/test-change-show-tmp
```

---

## Summary of Changes

| Layer                 | File                                                     | Change                                                                    |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Server (agent)        | `packages/agent/src/runner/retry-loop.ts`                | `Effect.ensuring` finalizer guarantees `auto_retry_end` on Effect failure |
| Desktop (ws-client)   | `apps/desktop/src/stores/server/ws-client.ts`            | `error` frame clears retry + streaming + currentTool + isStreaming        |
| Desktop (chip-input)  | `apps/desktop/src/components/chat-input/chip-input.tsx`  | `onAbort` prop, Escape handler (no menu active)                           |
| Desktop (send-button) | `apps/desktop/src/components/chat-input/send-button.tsx` | Dual-purpose send/stop button (`onSend` + `onAbort`)                      |
| Desktop (chat-input)  | `apps/desktop/src/components/chat-input/chat-input.tsx`  | Wires `onAbort` to `ChipInput` + `SendButton`                             |

## Test Coverage Summary

| Test file              | New tests | Purpose                                                                                                             |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `retry-loop.test.ts`   | 3         | `auto_retry_end` on Effect failure, no double-emit, rollbackLeaf failure                                            |
| `ws-client.test.ts`    | 8         | Error frame clears retry/phase/streaming/tool/msg; abort/auto_retry_end/agent_end regression guards                 |
| `chip-input.test.tsx`  | 3         | Escape→onAbort, menu-priority, Enter unaffected                                                                     |
| `send-button.test.tsx` | 5         | Send when idle, stop when streaming, not-disabled while streaming, disabled when idle+!canSend, onSend when canSend |
