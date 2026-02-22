import {
  recordChatPerfCounter,
  resetChatPerfTelemetry,
} from "@/core/chat/services/chat-perf-telemetry";
import { ChatPerfPanel } from "@/views/workspace-view/chat-area/perf/chat-perf-panel";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ChatPerfPanel", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    resetChatPerfTelemetry();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    dispose?.();
    document.body.removeChild(container);
  });

  it("renders telemetry values", async () => {
    ({ unmount: dispose } = render(() => <ChatPerfPanel />, { container }));

    recordChatPerfCounter("sseEvents", 10);
    recordChatPerfCounter("coalescedUpdates", 5);
    await vi.advanceTimersByTimeAsync(400);

    const panel = container.querySelector('[data-testid="chat-perf-panel"]');
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain("Stream Perf");
    expect(panel?.textContent).toContain("Coalesced");
    expect(panel?.textContent).toContain("5");
  });
});
