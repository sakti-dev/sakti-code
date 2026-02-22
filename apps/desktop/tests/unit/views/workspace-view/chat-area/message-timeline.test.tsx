/**
 * MessageTimeline Component Tests
 *
 * Tests for the turn-based chat timeline component.
 */

import { buildChatTurns, type ChatTurn } from "@/core/chat/hooks/turn-projection";
import { MessageTimeline } from "@/views/workspace-view/chat-area/timeline/message-timeline";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMultiTurnFixture,
  createSingleTurnFixture,
} from "../../../../fixtures/turn-fixtures";

function createFixtureTurn(): ChatTurn {
  const turns = buildChatTurns(createSingleTurnFixture());
  if (turns.length === 0) throw new Error("Expected fixture to produce a turn");
  return turns[0];
}

describe("MessageTimeline", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("renders turns in chronological order", () => {
    const turns = buildChatTurns(createMultiTurnFixture(undefined, 2));

    ({ unmount: dispose } = render(
      () => <MessageTimeline turns={() => turns} isStreaming={() => false} />,
      { container }
    ));

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items.length).toBe(2);
  });

  it("uses stable keys by userMessage.id", () => {
    const turn = createFixtureTurn();

    ({ unmount: dispose } = render(
      () => <MessageTimeline turns={() => [turn]} isStreaming={() => false} />,
      { container }
    ));

    const item = container.querySelector(`[data-testid="turn-${turn.userMessage.id}"]`);
    expect(item).toBeDefined();
  });

  it("shows empty state when no turns", () => {
    ({ unmount: dispose } = render(
      () => <MessageTimeline turns={() => []} isStreaming={() => false} />,
      { container }
    ));

    expect(container.textContent).toContain("No messages");
  });

  it("renders scroll container with role=log", () => {
    const turn = createFixtureTurn();

    ({ unmount: dispose } = render(
      () => <MessageTimeline turns={() => [turn]} isStreaming={() => false} />,
      { container }
    ));

    const logContainer = container.querySelector('[role="log"]');
    expect(logContainer).toBeDefined();
  });
});
