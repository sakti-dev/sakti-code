# Dev Toolbar — Design

**Goal:** A dev-only toolbar at the top of the message list that drives the UI into states that are otherwise hard to reach (a real rate-limit retry, a session replay) so the rendering can be visually verified. Never ships to production builds.

**Scope:** Two halves — replay controls (wired to existing actions) and a retry simulator (Approach A: real-timing exponential-backoff sequence through the real event path).

---

## Context

- Replay already exists as store actions + a `replayState()` signal (`ui-signals.ts`) but has **no visible UI** — only `session-turn.tsx` consumes the signal for styling. This toolbar becomes the replay control surface.
- The retry banner (`retry-banner.tsx`) is driven by `store.retry`, set/cleared by `auto_retry_start`/`auto_retry_end` events through the WS → reducer path. Reaching it normally requires a real transient provider error.

## Placement & gating

- Mounted in `task-chat-view.tsx`, above `<MessageTimeline>`.
- Gated by `import.meta.env.DEV` (Vite dev flag) so it is tree-shaken from production builds. Gate at the mount site.
- Visually distinct from product UI: muted/dev-tinted background, small ghost buttons, a tiny "DEV" tag — so it never reads as a real control.

## Replay half

Pure wiring to existing actions in `stores/server/actions.ts`, driven by the `replayState()` signal:

| `replayState()` | Buttons shown          |
| :-------------- | :--------------------- |
| `idle`          | `[ Replay session ]`   |
| `playing`       | `[ Pause ] [ Reset ]`  |
| `paused`        | `[ Resume ] [ Reset ]` |

Calls `actions.replayStart / replayPause / replayResume / replayReset(sessionId)`. No new logic.

## Retry half — Approach A (real-timing sequence)

A toggle button driven by an internal `running` signal:

- idle → `[ Trigger retry ]`
- running → `[ Stop retry ]`

**"Trigger retry"** runs a scripted sequence that dispatches **real** `auto_retry_start`/`auto_retry_end` events into the session's reducer — the same path WS uses (`dispatchEvent` with a no-op batcher; retry events never touch the batcher, so behavior is identical to production). The banner reads `store.retry`, which these events drive, so the attempt counter and delay update live:

```
start{attempt:1, delayMs:2000, maxAttempts:3, errorMessage:"429 Too Many Requests — rate limited"}
  → wait 2000ms →
start{attempt:2, delayMs:4000, …} → wait 4000ms →
start{attempt:3, delayMs:8000, …} → wait 8000ms →
end{success:false, attempt:3, finalError:"429 …"}
```

You watch the delay **2s → 4s → 8s** double across attempts, exactly as a sustained rate limit would show.

**Decisions:**

- **Fixed production defaults** (3 attempts, 2000ms base) rather than reading the session's live retry settings — keeps the preview predictable.
- **Same error message** across all 3 attempts (`"429 Too Many Requests — rate limited"`) — realistic for a sustained throttle.

**"Stop retry"** (or component unmount) clears pending timers and dispatches `end{success:false, …}` immediately.

## State & cleanup

- The sequence is `setTimeout`-chained; timer refs are held on the component.
- `onCleanup` clears all pending timers so navigating away mid-sequence can't leak timers or leave a stale banner.

## Testing

Component test (`@solidjs/testing-library`) with `vi.useFakeTimers`:

- Click "Trigger retry" → start event for attempt 1 dispatched.
- Advancing timers 2s / 4s / 8s → attempts 2, 3, then the end event (assert dispatched payloads + resulting `store.retry`).
- "Stop retry" mid-sequence → aborts and dispatches end.
- Unmount → pending timers cleared (no stray dispatch).
- Replay buttons render the correct set for each `replayState`.

## Out of scope

- Live countdown timer in the banner (already deferred in the retry plan).
- Per-session retry settings driving the preview (uses fixed defaults).
- A general "inject any event" palette — only replay + retry are exposed.
