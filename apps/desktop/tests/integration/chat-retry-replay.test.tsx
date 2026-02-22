import { clearEventProcessingState } from "@/core/chat/domain/event-router-adapter";
import { useSessionTurns } from "@/core/chat/hooks";
import {
  useMessageStore,
  usePartStore,
  useSessionStore,
} from "@/core/state/providers/store-provider";
import { MessageTimeline } from "@/views/workspace-view/chat-area/timeline/message-timeline";
import type { EventOrderingFixture } from "@sakti-code/shared";
import { render } from "@solidjs/testing-library";
import { Show, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyFixture, extractStoreActions } from "../helpers/fixture-loader";
import { TestProviders } from "../helpers/test-providers";

const sessionId = "019c6000-0000-7000-8000-000000000001";
const userId = "019c6000-0000-7000-8000-000000000002";
const assistantId = "019c6000-0000-7000-8000-000000000003";

const createRetryFixture = (): EventOrderingFixture => ({
  name: "retry-replay",
  description: "streams retry part and final text in chronological timeline",
  sessionId,
  events: [
    {
      type: "session.created",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000010",
      sequence: 1,
      timestamp: 1704067200100,
      properties: { sessionID: sessionId, directory: "/tmp" },
    },
    {
      type: "message.updated",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000011",
      sequence: 2,
      timestamp: 1704067200200,
      properties: {
        info: { role: "user", id: userId, sessionID: sessionId, time: { created: 1704067200200 } },
      },
    },
    {
      type: "message.part.updated",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000012",
      sequence: 3,
      timestamp: 1704067200300,
      properties: {
        part: {
          id: `${userId}-text`,
          type: "text",
          sessionID: sessionId,
          messageID: userId,
          text: "please inspect this repo",
          time: { start: 1704067200200, end: 1704067200200 },
        },
      },
    },
    {
      type: "message.updated",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000013",
      sequence: 4,
      timestamp: 1704067200400,
      properties: {
        info: {
          role: "assistant",
          id: assistantId,
          sessionID: sessionId,
          parentID: userId,
          time: { created: 1704067200400 },
        },
      },
    },
    {
      type: "message.part.updated",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000014",
      sequence: 5,
      timestamp: 1704067200500,
      properties: {
        part: {
          id: `${assistantId}-reasoning`,
          type: "reasoning",
          sessionID: sessionId,
          messageID: assistantId,
          text: "I will inspect project files first.",
          time: { start: 1704067200500, end: 1704067200550 },
        },
      },
    },
    {
      type: "message.part.updated",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000015",
      sequence: 6,
      timestamp: 1704067200600,
      properties: {
        part: {
          id: `${assistantId}-tool`,
          type: "tool",
          sessionID: sessionId,
          messageID: assistantId,
          tool: "ls",
          state: { status: "completed", time: { start: 1704067200600, end: 1704067200680 } },
        },
      },
    },
    {
      type: "message.part.updated",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000016",
      sequence: 7,
      timestamp: 1704067200700,
      properties: {
        part: {
          id: `${assistantId}-retry`,
          type: "retry",
          sessionID: sessionId,
          messageID: assistantId,
          attempt: 1,
          next: Date.now() + 3000,
          error: {
            message: "Cannot connect to API: other side closed",
            isRetryable: true,
            metadata: { kind: "network_socket_closed" },
          },
          time: { created: 1704067200700 },
        },
      },
    },
    {
      type: "session.status",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000017",
      sequence: 8,
      timestamp: 1704067200800,
      properties: {
        sessionID: sessionId,
        status: {
          type: "retry",
          attempt: 1,
          message: "Model connection dropped while streaming",
          next: Date.now() + 3000,
        },
      },
    },
    {
      type: "message.part.updated",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000018",
      sequence: 9,
      timestamp: 1704067200900,
      properties: {
        part: {
          id: `${assistantId}-text`,
          type: "text",
          sessionID: sessionId,
          messageID: assistantId,
          text: "Repository scanned successfully.",
          time: { start: 1704067200900, end: 1704067200950 },
        },
      },
    },
    {
      type: "session.status",
      sessionID: sessionId,
      eventId: "019c6000-0000-7000-8000-000000000019",
      sequence: 10,
      timestamp: 1704067201000,
      properties: {
        sessionID: sessionId,
        status: { type: "idle" },
      },
    },
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: true,
    typingIndicatorVisible: false,
    hasError: false,
  },
});

describe("Integration: Chat Retry Replay", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    clearEventProcessingState();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    clearEventProcessingState();
    container.remove();
    vi.useRealTimers();
  });

  it("renders retry part inline in chronological order and clears working state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T00:00:00.000Z"));

    const fixture = createRetryFixture();
    const [sid] = createSignal<string | null>(fixture.sessionId);
    const [ready, setReady] = createSignal(false);

    let storeContext: {
      message: [unknown, ReturnType<typeof useMessageStore>[1]];
      part: [unknown, ReturnType<typeof usePartStore>[1]];
      session: [unknown, ReturnType<typeof useSessionStore>[1]];
    };

    function TestApp() {
      storeContext = {
        message: useMessageStore(),
        part: usePartStore(),
        session: useSessionStore(),
      };
      return (
        <Show when={ready()}>
          <MessageTimeline turns={useSessionTurns(sid)} isStreaming={() => false} />
        </Show>
      );
    }

    const { unmount: dispose } = render(
      () => (
        <TestProviders>
          <TestApp />
        </TestProviders>
      ),
      { container }
    );

    await applyFixture(fixture, extractStoreActions(storeContext!));
    setReady(true);
    await Promise.resolve();
    await Promise.resolve();

    const stream = container.querySelector('[data-slot="session-turn-stream"]');
    expect(stream).toBeTruthy();
    const sequence = Array.from(
      stream!.querySelectorAll(
        '[data-component="reasoning-part"],[data-component="tool-part-wrapper"],[data-component="retry-part"],[data-component="text-part"]'
      )
    ).map(node => node.getAttribute("data-component"));

    expect(sequence).toEqual(["reasoning-part", "tool-part-wrapper", "retry-part", "text-part"]);
    expect(container.textContent).toContain("Repository scanned successfully.");
    expect(container.textContent).not.toContain("Working");

    dispose();
  });
});
