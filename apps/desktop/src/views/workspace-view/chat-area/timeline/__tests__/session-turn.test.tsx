import { buildChatTurns, type ChatTurn } from "@/core/chat/hooks/turn-projection";
import {
  createErrorTurnFixture,
  createInterleavedAssistantPartsFixture,
  createInterleavedAssistantPartsWithRetryFixture,
  createSingleTurnFixture,
  createSingleTurnWithPromptsFixture,
  createStreamingTurnFixture,
} from "@/fixtures/turn-fixtures";
import { SessionTurn } from "@/views/workspace-view/chat-area/timeline/session-turn";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    ({ unmount: dispose } = render(
      () => <SessionTurn turn={() => turn} isStreaming={() => false} />,
      { container }
    ));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("I'd be happy to help");
    });
  });

  it("does not render a steps trigger/collapsible label", () => {
    const turn = projectSingleTurn(createSingleTurnWithPromptsFixture());

    ({ unmount: dispose } = render(
      () => <SessionTurn turn={() => turn} isStreaming={() => true} />,
      { container }
    ));

    expect(container.textContent).not.toContain("Show steps");
    expect(container.textContent).not.toContain("Hide steps");
    expect(container.querySelector('[data-slot="steps-trigger"]')).toBeNull();
  });

  it("renders reasoning inline without a reasoning collapsible trigger", async () => {
    const turn = projectSingleTurn(createInterleavedAssistantPartsFixture());

    ({ unmount: dispose } = render(
      () => <SessionTurn turn={() => turn} isStreaming={() => true} />,
      { container }
    ));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("The read result suggests checking related files.");
      expect(container.querySelector('[data-slot="reasoning-trigger"]')).toBeNull();
    });
  });

  it("renders assistant parts chronologically in a single inline stream", async () => {
    const turn = projectSingleTurn(createInterleavedAssistantPartsFixture());

    ({ unmount: dispose } = render(
      () => <SessionTurn turn={() => turn} isStreaming={() => true} />,
      { container }
    ));

    await vi.waitFor(() => {
      const stream = container.querySelector('[data-slot="session-turn-stream"]');
      expect(stream).not.toBeNull();
    });

    const stream = container.querySelector('[data-slot="session-turn-stream"]') as HTMLElement;
    const renderedSequence = Array.from(
      stream.querySelectorAll(
        '[data-component="text-part"], [data-component="tool-part-wrapper"], [data-component="reasoning-part"], [data-component="permission-part"], [data-component="question-part"]'
      )
    )
      .map(element => element.getAttribute("data-component"))
      .filter((value): value is string => Boolean(value));

    expect(renderedSequence).toEqual([
      "text-part",
      "tool-part-wrapper",
      "reasoning-part",
      "tool-part-wrapper",
      "permission-part",
      "reasoning-part",
      "question-part",
      "text-part",
    ]);
  });

  it("renders retry parts inline in chronological order", async () => {
    const turn = projectSingleTurn(createInterleavedAssistantPartsWithRetryFixture());

    ({ unmount: dispose } = render(
      () => <SessionTurn turn={() => turn} isStreaming={() => true} />,
      { container }
    ));

    await vi.waitFor(() => {
      const stream = container.querySelector('[data-slot="session-turn-stream"]');
      expect(stream).not.toBeNull();
    });

    const stream = container.querySelector('[data-slot="session-turn-stream"]') as HTMLElement;
    const renderedSequence = Array.from(
      stream.querySelectorAll(
        '[data-component="text-part"], [data-component="tool-part-wrapper"], [data-component="reasoning-part"], [data-component="permission-part"], [data-component="retry-part"], [data-component="question-part"]'
      )
    )
      .map(element => element.getAttribute("data-component"))
      .filter((value): value is string => Boolean(value));

    expect(renderedSequence).toEqual([
      "text-part",
      "tool-part-wrapper",
      "reasoning-part",
      "tool-part-wrapper",
      "permission-part",
      "retry-part",
      "reasoning-part",
      "question-part",
      "text-part",
    ]);
  });

  it("throttles status label transitions for active streaming turns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T00:00:00.000Z"));

    const baseTurn = projectSingleTurn(createStreamingTurnFixture());
    const [turn, setTurn] = createSignal({ ...baseTurn, statusLabel: "Thinking", working: true });

    ({ unmount: dispose } = render(() => <SessionTurn turn={turn} isStreaming={() => true} />, {
      container,
    }));

    expect(container.textContent).toContain("Thinking");

    setTurn(prev => ({ ...prev, statusLabel: "Running commands" }));
    vi.advanceTimersByTime(1000);
    expect(container.textContent).toContain("Thinking");

    vi.advanceTimersByTime(1500);
    expect(container.textContent).toContain("Running commands");
  });

  it("uses non-noisy live region behavior", () => {
    const streamingTurn = projectSingleTurn(createStreamingTurnFixture());

    ({ unmount: dispose } = render(
      () => <SessionTurn turn={() => streamingTurn} isStreaming={() => true} />,
      { container }
    ));

    const visibleSummaryLive = container.querySelector(
      '[data-slot="session-turn-visible-stream-live"]'
    );
    expect(visibleSummaryLive?.getAttribute("aria-live")).toBe("off");
  });

  it("renders error state from fixture", () => {
    const turn = projectSingleTurn(createErrorTurnFixture());

    ({ unmount: dispose } = render(
      () => <SessionTurn turn={() => turn} isStreaming={() => false} />,
      { container }
    ));

    expect(container.textContent).toContain("Something went wrong");
  });
});
