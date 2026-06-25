# Dev Toolbar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A dev-only toolbar at the top of the message list that surfaces replay controls and a "trigger retry" button which plays a real-timing exponential-backoff sequence (2s/4s/8s) through the real `auto_retry` event path so the retry banner can be visually verified without a real rate limit.

**Architecture:** A single presentational `DevToolbar` component, **props-driven** (not context-coupled) so it renders directly in tests without `StoreProvider`. The parent (`task-chat-view.tsx`) wires props to the store: replay callbacks to existing `actions.replay*`, and `onRetryEvent` dispatching into the session reducer via `dispatchEvent` with a shared no-op batcher (retry events never use the batcher). The toolbar owns the retry sequence state (`setTimeout`-chained, cleared on stop/unmount). Gated at the mount site by `import.meta.env.DEV` so it is tree-shaken from production builds.

**Tech Stack:** TypeScript, SolidJS, vitest (`@solidjs/testing-library`, `vi.useFakeTimers`), Tailwind, `@sakti-code/agent` event types.

**Reference design:** `docs/plans/2026-06-25-dev-toolbar-design.md`

---

## Constraints

- `exactOptionalPropertyTypes: true` — conditional spread, never pass `undefined`.
- Biome: `noExcessiveCognitiveComplexity: 20`, `noDelete`, `noNestedTernary`, `useLiteralKeys`, `useTopLevelRegex` (hoist regexes).
- SolidJS: use `class`/`for` (not `className`/`htmlFor`).
- No `console.log`/`debugger`. Helpful comments on production code (user preference).
- TDD: failing test → verify RED → implement → verify GREEN → commit.

---

## Task 1: DevToolbar replay controls (TDD)

**Files:**
- Create: `apps/desktop/src/components/chat-area/dev-toolbar.tsx`
- Create: `apps/desktop/src/components/__tests__/dev-toolbar.test.tsx`

### Step 1: Write the failing test (replay button sets per state)

Create `apps/desktop/src/components/__tests__/dev-toolbar.test.tsx`:

```typescript
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { AgentHarnessEvent } from "@sakti-code/agent";
import type { ReplayState } from "../../stores/workspace/ui-signals.ts";
import { DevToolbar } from "../chat-area/dev-toolbar.tsx";

/** Render the toolbar with a controllable replayState signal + spies. */
function setup(initial: ReplayState = "idle") {
  const [replay, setReplay] = createSignal<ReplayState>(initial);
  const spies = {
    onReplayStart: vi.fn(),
    onReplayPause: vi.fn(),
    onReplayResume: vi.fn(),
    onReplayReset: vi.fn(),
    onRetryEvent: vi.fn(),
  };
  const result = render(() => (
    <DevToolbar
      sessionId="s1"
      replayState={replay}
      onReplayStart={spies.onReplayStart}
      onReplayPause={spies.onReplayPause}
      onReplayResume={spies.onReplayResume}
      onReplayReset={spies.onReplayReset}
      onRetryEvent={spies.onRetryEvent}
    />
  ));
  return { ...result, setReplay, spies };
}

describe("DevToolbar — replay controls", () => {
  it("shows only 'Replay session' when idle", () => {
    const { queryByRole } = setup("idle");
    expect(queryByRole("button", { name: "Replay session" })).toBeTruthy();
    expect(queryByRole("button", { name: "Pause" })).toBeNull();
    expect(queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("shows Pause + Reset when playing", () => {
    const { queryByRole } = setup("playing");
    expect(queryByRole("button", { name: "Pause" })).toBeTruthy();
    expect(queryByRole("button", { name: "Reset" })).toBeTruthy();
    expect(queryByRole("button", { name: "Replay session" })).toBeNull();
  });

  it("shows Resume + Reset when paused", () => {
    const { queryByRole } = setup("paused");
    expect(queryByRole("button", { name: "Resume" })).toBeTruthy();
    expect(queryByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("calls the matching replay callback on click", () => {
    const { getByRole, spies } = setup("playing");
    getByRole("button", { name: "Pause" }).click();
    expect(spies.onReplayPause).toHaveBeenCalledTimes(1);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd apps/desktop && npx vitest run src/components/__tests__/dev-toolbar.test.tsx`
Expected: FAIL — module `../chat-area/dev-toolbar.tsx` not found.

### Step 3: Implement the replay half of DevToolbar

Create `apps/desktop/src/components/chat-area/dev-toolbar.tsx`:

```typescript
import type { AgentHarnessEvent } from "@sakti-code/agent";
import { Match, Switch, type JSX } from "solid-js";
import { Button } from "~/components/ui/button";
import type { ReplayState } from "~/stores/workspace/ui-signals";

export interface DevToolbarProps {
  sessionId: string;
  /** Reactive replay state — drives which replay buttons show. */
  replayState: () => ReplayState;
  onReplayStart: () => void;
  onReplayPause: () => void;
  onReplayResume: () => void;
  onReplayReset: () => void;
  /** Dispatch a retry event (auto_retry_start/end) into the session reducer. */
  onRetryEvent: (event: AgentHarnessEvent) => void;
}

/**
 * Dev-only toolbar for visually verifying UI states that are hard to reach
 * normally (replay, transient-error retry). Gated at the mount site by
 * `import.meta.env.DEV`; this component itself is dev tooling, not product UI.
 */
export function DevToolbar(props: DevToolbarProps): JSX.Element {
  return (
    <div
      class="flex items-center gap-2 border-b border-dashed border-border bg-muted/40 px-3 py-1.5 text-xs"
      data-testid="dev-toolbar"
    >
      <span class="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        DEV
      </span>
      <Switch>
        <Match when={props.replayState() === "idle"}>
          <Button variant="ghost" size="sm" onClick={props.onReplayStart}>
            Replay session
          </Button>
        </Match>
        <Match when={props.replayState() === "playing"}>
          <Button variant="ghost" size="sm" onClick={props.onReplayPause}>
            Pause
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onReplayReset}>
            Reset
          </Button>
        </Match>
        <Match when={props.replayState() === "paused"}>
          <Button variant="ghost" size="sm" onClick={props.onReplayResume}>
            Resume
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onReplayReset}>
            Reset
          </Button>
        </Match>
      </Switch>
    </div>
  );
}
```

### Step 4: Run test to verify it passes

Run: `cd apps/desktop && npx vitest run src/components/__tests__/dev-toolbar.test.tsx`
Expected: PASS (4 tests).

### Step 5: Commit

```bash
git add apps/desktop/src/components/chat-area/dev-toolbar.tsx apps/desktop/src/components/__tests__/dev-toolbar.test.tsx
git commit -m "feat(desktop): dev toolbar scaffold + replay controls"
```

---

## Task 2: Retry simulator (TDD, fake timers)

**Files:**
- Modify: `apps/desktop/src/components/chat-area/dev-toolbar.tsx`
- Modify: `apps/desktop/src/components/__tests__/dev-toolbar.test.tsx`

### Step 1: Add the failing retry-sequence tests

Append to `apps/desktop/src/components/__tests__/dev-toolbar.test.tsx` (after the existing `setup` helper and replay `describe`):

```typescript
import { afterEach, beforeEach } from "vitest";

const LAST_EVENT = (fn: ReturnType<typeof vi.fn>) =>
  (fn.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;

describe("DevToolbar — retry simulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle showing 'Trigger retry'", () => {
    const { queryByRole } = setup("idle");
    expect(queryByRole("button", { name: "Trigger retry" })).toBeTruthy();
  });

  it("plays the 2s/4s/8s sequence then ends in failure", () => {
    const { getByRole, spies } = setup("idle");
    getByRole("button", { name: "Trigger retry" }).click();

    // Attempt 1 fires immediately.
    expect(LAST_EVENT(spies.onRetryEvent)).toMatchObject({
      type: "auto_retry_start",
      attempt: 1,
      delayMs: 2000,
      maxAttempts: 3,
    });

    vi.advanceTimersByTime(2000);
    expect(LAST_EVENT(spies.onRetryEvent)).toMatchObject({
      type: "auto_retry_start",
      attempt: 2,
      delayMs: 4000,
    });

    vi.advanceTimersByTime(4000);
    expect(LAST_EVENT(spies.onRetryEvent)).toMatchObject({
      type: "auto_retry_start",
      attempt: 3,
      delayMs: 8000,
    });

    vi.advanceTimersByTime(8000);
    expect(LAST_EVENT(spies.onRetryEvent)).toMatchObject({
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: expect.any(String),
    });
    // Button reverts to the trigger label.
    expect(getByRole("button", { name: "Trigger retry" })).toBeTruthy();
  });

  it("'Stop retry' aborts mid-sequence and emits end with the current attempt", () => {
    const { getByRole, spies } = setup("idle");
    getByRole("button", { name: "Trigger retry" }).click();
    vi.advanceTimersByTime(2000); // attempt 2 has fired; current attempt = 2

    getByRole("button", { name: "Stop retry" }).click();
    expect(LAST_EVENT(spies.onRetryEvent)).toMatchObject({
      type: "auto_retry_end",
      success: false,
      attempt: 2,
    });

    // No further events fire after stopping.
    const callsBefore = spies.onRetryEvent.mock.calls.length;
    vi.advanceTimersByTime(20000);
    expect(spies.onRetryEvent.mock.calls.length).toBe(callsBefore);
  });

  it("clears pending timers on unmount (no stray dispatches)", () => {
    const { getByRole, dispose, spies } = setup("idle");
    getByRole("button", { name: "Trigger retry" }).click();
    const callsBefore = spies.onRetryEvent.mock.calls.length;

    dispose();
    vi.advanceTimersByTime(20000);
    expect(spies.onRetryEvent.mock.calls.length).toBe(callsBefore);
  });
});
```

### Step 2: Run tests to verify the new ones fail

Run: `cd apps/desktop && npx vitest run src/components/__tests__/dev-toolbar.test.tsx`
Expected: FAIL — no "Trigger retry" button (retry UI not implemented).

### Step 3: Implement the retry simulator

Modify `apps/desktop/src/components/chat-area/dev-toolbar.tsx` — add the retry sequence. Replace the `import` line and the component body:

```typescript
import type { AgentHarnessEvent } from "@sakti-code/agent";
import { createSignal, Match, onCleanup, Switch, type JSX } from "solid-js";
import { Button } from "~/components/ui/button";
import type { ReplayState } from "~/stores/workspace/ui-signals";

/** Realistic sustained-throttle error used across all simulated attempts. */
const RETRY_ERROR_MESSAGE = "429 Too Many Requests — rate limited";
/** Production retry defaults — kept fixed so the preview is predictable. */
const MAX_ATTEMPTS = 3;
/** Exponential backoff schedule: base 2000ms → 2s, 4s, 8s. */
const RETRY_SCHEDULE = [
  { attempt: 1, delayMs: 2000 },
  { attempt: 2, delayMs: 4000 },
  { attempt: 3, delayMs: 8000 },
] as const;

export interface DevToolbarProps {
  sessionId: string;
  replayState: () => ReplayState;
  onReplayStart: () => void;
  onReplayPause: () => void;
  onReplayResume: () => void;
  onReplayReset: () => void;
  onRetryEvent: (event: AgentHarnessEvent) => void;
}

export function DevToolbar(props: DevToolbarProps): JSX.Element {
  // Retry-sim state. `running` drives the button label; timers are cleared on
  // stop or unmount so a mid-sequence navigation can't leak or leave a banner.
  const [retryRunning, setRetryRunning] = createSignal(false);
  let timers: ReturnType<typeof setTimeout>[] = [];
  // Last attempt number dispatched — used to label the abort end event.
  let currentAttempt = 0;

  function clearTimers(): void {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers = [];
  }

  function emitStart(attempt: number, delayMs: number): void {
    currentAttempt = attempt;
    props.onRetryEvent({
      type: "auto_retry_start",
      attempt,
      delayMs,
      errorMessage: RETRY_ERROR_MESSAGE,
      maxAttempts: MAX_ATTEMPTS,
    });
  }

  function emitEnd(): void {
    props.onRetryEvent({
      type: "auto_retry_end",
      success: false,
      attempt: currentAttempt,
      finalError: RETRY_ERROR_MESSAGE,
    });
  }

  function startRetry(): void {
    setRetryRunning(true);
    currentAttempt = 0;
    // Schedule each attempt's start event at its cumulative offset, then the
    // final end event after the last wait. Real 2s/4s/8s timing (Approach A).
    let elapsed = 0;
    for (const step of RETRY_SCHEDULE) {
      const at = elapsed;
      const { attempt, delayMs } = step;
      timers.push(setTimeout(() => emitStart(attempt, delayMs), at));
      elapsed += delayMs;
    }
    timers.push(
      setTimeout(() => {
        emitEnd();
        setRetryRunning(false);
      }, elapsed),
    );
  }

  function stopRetry(): void {
    clearTimers();
    // Only emit an end if a start actually went out.
    if (currentAttempt > 0) {
      emitEnd();
    }
    setRetryRunning(false);
  }

  onCleanup(clearTimers);

  return (
    <div
      class="flex items-center gap-2 border-b border-dashed border-border bg-muted/40 px-3 py-1.5 text-xs"
      data-testid="dev-toolbar"
    >
      <span class="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        DEV
      </span>
      <Switch>
        <Match when={props.replayState() === "idle"}>
          <Button variant="ghost" size="sm" onClick={props.onReplayStart}>
            Replay session
          </Button>
        </Match>
        <Match when={props.replayState() === "playing"}>
          <Button variant="ghost" size="sm" onClick={props.onReplayPause}>
            Pause
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onReplayReset}>
            Reset
          </Button>
        </Match>
        <Match when={props.replayState() === "paused"}>
          <Button variant="ghost" size="sm" onClick={props.onReplayResume}>
            Resume
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onReplayReset}>
            Reset
          </Button>
        </Match>
      </Switch>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => (retryRunning() ? stopRetry() : startRetry())}
      >
        {retryRunning() ? "Stop retry" : "Trigger retry"}
      </Button>
    </div>
  );
}
```

### Step 4: Run tests to verify they pass

Run: `cd apps/desktop && npx vitest run src/components/__tests__/dev-toolbar.test.tsx`
Expected: PASS (8 tests: 4 replay + 4 retry).

### Step 5: Commit

```bash
git add apps/desktop/src/components/chat-area/dev-toolbar.tsx apps/desktop/src/components/__tests__/dev-toolbar.test.tsx
git commit -m "feat(desktop): dev toolbar retry simulator (2s/4s/8s backoff)

Plays a real-timing exponential-backoff sequence through the real
auto_retry_start/end event path so the retry banner renders exactly as
in production. Stop + unmount clear pending timers."
```

---

## Task 3: Wire into task-chat-view with DEV gate + verify

**Files:**
- Modify: `apps/desktop/src/components/chat-area/task-chat-view.tsx`

### Step 1: Mount the toolbar gated by `import.meta.env.DEV`

In `apps/desktop/src/components/chat-area/task-chat-view.tsx`, add imports and render the toolbar above `<MessageTimeline>`. The `onRetryEvent` handler dispatches into the session reducer via `dispatchEvent` with a shared no-op batcher (retry events never feed the batcher):

```typescript
import { createMemo, type JSX, onMount, Show } from "solid-js";
import { DevToolbar } from "~/components/chat-area/dev-toolbar";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { RetryBanner } from "~/components/chat-area/retry-banner";
import { ChatInput } from "~/components/chat-input/chat-input";
import { dispatchEvent } from "~/stores/session/event-reducer";
import { buildChatTurns } from "~/stores/session/turn-projection";
import { createTokenBatcher } from "~/stores/session/token-batcher";
import { replayState } from "~/stores/workspace/ui-signals";
import { useStore } from "~/stores/store-context";

// Dev-only no-op batcher: retry events never append tokens, so a disposable
// batcher that flushes to nothing is all dispatchEvent needs for them.
const devBatcher = createTokenBatcher(() => {}, { batch: false });

interface TaskChatViewProps {
  sessionId: string;
}

export function TaskChatView(props: TaskChatViewProps): JSX.Element {
  const { sessions, actions } = useStore();

  const sessionStore = createMemo(() => sessions.get(props.sessionId));

  onMount(() => {
    actions.loadMessages(props.sessionId);
  });

  const turns = createMemo(() => {
    const session = sessionStore();
    if (!session) {
      return [];
    }
    return buildChatTurns(
      session.store.messageOrder,
      session.store.messages,
      session.store.streaming.phase,
      session.store.turnTimings
    );
  });

  const isGenerating = () => sessionStore()?.store.streaming.phase !== "idle";

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      {import.meta.env.DEV && (
        <DevToolbar
          sessionId={props.sessionId}
          replayState={replayState}
          onReplayStart={() => actions.replayStart(props.sessionId)}
          onReplayPause={() => actions.replayPause(props.sessionId)}
          onReplayResume={() => actions.replayResume(props.sessionId)}
          onReplayReset={() => actions.replayReset(props.sessionId)}
          onRetryEvent={(event) => {
            const session = sessions.get(props.sessionId);
            dispatchEvent(session.actions, devBatcher, event);
          }}
        />
      )}
      <MessageTimeline isStreaming={isGenerating} turns={turns} />
      <Show when={sessionStore()?.store.retry}>
        {(retry) => (
          <RetryBanner
            retry={retry()}
            onCancel={() => actions.abortRun(props.sessionId)}
          />
        )}
      </Show>
      <ChatInput placeholder="Continue working…" sessionId={props.sessionId} />
    </div>
  );
}
```

### Step 2: Verify typecheck + full desktop suite

Run: `cd apps/desktop && nub run typecheck && nub run test`
Expected: typecheck clean; tests green (245 + 8 new dev-toolbar tests). The 44 SolidJS HMR errors are pre-existing.

### Step 3: Verify production gate excludes it

Confirm the DEV gate tree-shakes. Run a production build (optional sanity):

```bash
cd apps/desktop && nub run build 2>&1 | tail -20
```
Expected: build succeeds (the DevToolbar import remains but the `{import.meta.env.DEV && ...}` branch is dead in prod).

### Step 4: Commit

```bash
git add apps/desktop/src/components/chat-area/task-chat-view.tsx
git commit -m "feat(desktop): mount dev toolbar (DEV-gated) in task-chat-view

Wires replay controls to existing actions and the retry simulator's
events to the session reducer via dispatchEvent. import.meta.env.DEV
gate keeps it out of production builds."
```

---

## Verification checklist

- [ ] `nub run typecheck` — 6/6 packages clean.
- [ ] `apps/desktop` tests green (253 total: 245 + 8 new).
- [ ] Manual: `cd apps/desktop && nub run dev`, open a session, click "Trigger retry" in the DEV toolbar at the top — watch the retry banner (above the input) cycle attempt 1→2→3 with 2s/4s/8s, then clear. Click "Stop retry" mid-sequence to abort. Replay buttons reflect `replayState`.
