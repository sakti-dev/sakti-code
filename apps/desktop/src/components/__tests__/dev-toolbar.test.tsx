import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
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
