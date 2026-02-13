import { buildChatTurns, type ChatTurn } from "@/core/chat/hooks/turn-projection";
import { SessionTurn } from "@/views/workspace-view/chat-area";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createErrorTurnFixture,
  createSingleTurnFixture,
  createSingleTurnWithPromptsFixture,
  createStreamingTurnFixture,
} from "../../../../fixtures/turn-fixtures";

function projectSingleTurn(
  fixture:
    | ReturnType<typeof createSingleTurnFixture>
    | ReturnType<typeof createStreamingTurnFixture>
    | ReturnType<typeof createSingleTurnWithPromptsFixture>
    | ReturnType<typeof createErrorTurnFixture>
): ChatTurn {
  const turns = buildChatTurns(fixture);
  if (turns.length === 0) {
    throw new Error("Expected at least one turn in fixture");
  }
  return turns[0];
}

describe("SessionTurn", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it("renders fixture-derived assistant summary text", async () => {
    const turn = projectSingleTurn(createSingleTurnFixture());

    dispose = render(() => <SessionTurn turn={() => turn} isStreaming={() => false} />, container);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("I'd be happy to help");
    });
  });

  it("shows steps trigger for prompt parts from fixtures", () => {
    const turn = projectSingleTurn(createSingleTurnWithPromptsFixture());

    dispose = render(() => <SessionTurn turn={() => turn} isStreaming={() => true} />, container);

    const stepsTrigger = container.querySelector('[data-slot="steps-trigger"]');
    expect(stepsTrigger).not.toBeNull();
  });

  it("toggles steps expanded state and aria-expanded", () => {
    const turn = projectSingleTurn(createStreamingTurnFixture());

    dispose = render(() => <SessionTurn turn={() => turn} isStreaming={() => true} />, container);

    const stepsTrigger = container.querySelector(
      '[data-slot="steps-trigger"]'
    ) as HTMLButtonElement;
    expect(stepsTrigger.getAttribute("aria-expanded")).toBe("false");

    stepsTrigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(stepsTrigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("supports keyboard interaction for steps trigger", () => {
    const turn = projectSingleTurn(createStreamingTurnFixture());

    dispose = render(() => <SessionTurn turn={() => turn} isStreaming={() => true} />, container);

    const stepsTrigger = container.querySelector(
      '[data-slot="steps-trigger"]'
    ) as HTMLButtonElement;
    stepsTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(stepsTrigger.getAttribute("aria-expanded")).toBe("true");

    stepsTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(stepsTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("throttles status label transitions for active streaming turns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T00:00:00.000Z"));

    const baseTurn = projectSingleTurn(createStreamingTurnFixture());
    const [turn, setTurn] = createSignal({ ...baseTurn, statusLabel: "Thinking", working: true });

    dispose = render(() => <SessionTurn turn={turn} isStreaming={() => true} />, container);

    expect(container.textContent).toContain("Thinking");

    setTurn(prev => ({ ...prev, statusLabel: "Running commands" }));
    vi.advanceTimersByTime(1000);
    expect(container.textContent).toContain("Thinking");

    vi.advanceTimersByTime(1500);
    expect(container.textContent).toContain("Running commands");
  });

  it("uses non-noisy live region behavior", () => {
    const streamingTurn = projectSingleTurn(createStreamingTurnFixture());

    dispose = render(
      () => <SessionTurn turn={() => streamingTurn} isStreaming={() => true} />,
      container
    );

    const visibleSummaryLive = container.querySelector(
      '[data-slot="session-turn-visible-summary-live"]'
    );
    expect(visibleSummaryLive?.getAttribute("aria-live")).toBe("off");
  });

  it("renders error state from fixture", () => {
    const turn = projectSingleTurn(createErrorTurnFixture());

    dispose = render(() => <SessionTurn turn={() => turn} isStreaming={() => false} />, container);

    expect(container.textContent).toContain("Something went wrong");
  });
});
