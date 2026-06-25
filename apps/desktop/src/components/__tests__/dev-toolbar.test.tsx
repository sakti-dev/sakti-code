import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayState } from "../../stores/workspace/ui-signals.ts";
import { DevToolbar } from "../chat-area/dev-toolbar.tsx";

/**
 * Render the toolbar with a controllable replayState signal + spies.
 * The toolbar is props-driven (not context-coupled) so it renders directly
 * in tests without a StoreProvider.
 */
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
      onReplayPause={spies.onReplayPause}
      onReplayReset={spies.onReplayReset}
      onReplayResume={spies.onReplayResume}
      onReplayStart={spies.onReplayStart}
      onRetryEvent={spies.onRetryEvent}
      replayState={replay}
      sessionId="s1"
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

/** Inspect the last event dispatched by the retry simulator. */
const LAST_EVENT = (fn: ReturnType<typeof vi.fn>): Record<string, unknown> =>
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
    vi.advanceTimersByTime(20_000);
    expect(spies.onRetryEvent.mock.calls.length).toBe(callsBefore);
  });

  it("clears pending timers on unmount (no stray dispatches)", () => {
    const { getByRole, unmount, spies } = setup("idle");
    getByRole("button", { name: "Trigger retry" }).click();
    const callsBefore = spies.onRetryEvent.mock.calls.length;

    unmount();
    vi.advanceTimersByTime(20_000);
    expect(spies.onRetryEvent.mock.calls.length).toBe(callsBefore);
  });
});
