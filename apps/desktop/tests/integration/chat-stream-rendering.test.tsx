/**
 * Integration Tests: Chat Stream Rendering
 *
 * End-to-end tests for chat streaming and rendering with real providers.
 * Uses event ordering fixtures to validate rendering behavior.
 * Part of Batch 5: WS7 Testing Overhaul
 *
 * @package @sakti-code/desktop/tests
 */

import { clearEventProcessingState } from "@/core/chat/domain/event-router-adapter";
import {
  useMessageStore,
  usePartStore,
  useSessionStore,
} from "@/core/state/providers/store-provider";
import { allEventOrderingFixtures } from "@sakti-code/shared";
import type { Part } from "@sakti-code/shared/event-types";
import { cleanup, render } from "@solidjs/testing-library";
import { createMemo, createSignal, For } from "solid-js";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  expectAssistantContentVisible,
  expectTypingIndicatorHidden,
  expectTypingIndicatorVisible,
  expectUserMessageVisible,
  flushReactive,
} from "../helpers/dom-assertions";
import { applyFixture, extractStoreActions } from "../helpers/fixture-loader";
import { TestProviders } from "../helpers/test-providers";

afterEach(cleanup);

describe("Integration: Chat Stream Rendering", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    clearEventProcessingState();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    clearEventProcessingState();
    container.remove();
  });

  /**
   * Test component that renders messages like the real message list
   */
  function ChatMessageList(props: { sessionId: () => string | null }) {
    const [, messageActions] = useMessageStore();
    const [, partActions] = usePartStore();
    const [sessionState] = useSessionStore();

    const messages = createMemo(() => {
      const sessionId = props.sessionId();
      if (!sessionId) return [];
      return messageActions.getBySession(sessionId);
    });

    const isGenerating = createMemo(() => {
      const sessionId = props.sessionId();
      if (!sessionId) return false;
      const status = sessionState.status[sessionId];
      return status?.type === "busy";
    });

    const hasAssistantContent = createMemo(() => {
      const msgs = messages();
      const assistantMsgs = msgs.filter(m => m.role === "assistant");
      if (assistantMsgs.length === 0) return false;

      // Check if any assistant message has parts
      for (const msg of assistantMsgs) {
        const parts = partActions.getByMessage(msg.id);
        if (parts.length > 0) return true;
      }
      return false;
    });

    const showTypingIndicator = createMemo(() => {
      return isGenerating() && !hasAssistantContent();
    });

    return (
      <div data-testid="message-list">
        <div data-testid="messages-container">
          <For each={messages()}>
            {msg => (
              <div data-role={msg.role} data-message-id={msg.id} data-testid={`message-${msg.id}`}>
                <span data-testid="message-content">{String(msg.content ?? "")}</span>
                {msg.role === "assistant" && (
                  <div data-testid="assistant-parts">
                    <For each={partActions.getByMessage(msg.id)}>
                      {part => (
                        <div data-part-id={(part as Part).id} data-part-type={(part as Part).type}>
                          {(part as Part).type === "text" &&
                            ((part as { text?: string }).text || "")}
                          {(part as Part).type === "tool-call" && "[Tool Call]"}
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </div>
            )}
          </For>
        </div>

        <div
          data-testid="typing-indicator"
          data-visible={showTypingIndicator() ? "true" : "false"}
          style={{ display: showTypingIndicator() ? "block" : "none" }}
        >
          <span>Typing... (content-priority: {!hasAssistantContent()})</span>
        </div>
      </div>
    );
  }

  /**
   * Table-driven tests for all event ordering fixtures
   */
  describe.each(allEventOrderingFixtures)("Fixture: $name", fixture => {
    it("renders user message when expected", async () => {
      const [sessionId] = createSignal(fixture.sessionId);

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
        return <ChatMessageList sessionId={sessionId} />;
      }

      const view = render(
        () => (
          <TestProviders>
            <TestApp />
          </TestProviders>
        ),
        { container }
      );

      // Apply fixture events to stores
      const actions = extractStoreActions(storeContext!);
      await applyFixture(fixture, actions);

      // Wait for reactive updates
      await flushReactive();

      // Assert based on expected behavior
      if (fixture.expectedBehavior.userMessageVisible) {
        expectUserMessageVisible(container);
      }

      view.unmount();
    });

    it("renders assistant content when expected", async () => {
      const [sessionId] = createSignal(fixture.sessionId);

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
        return <ChatMessageList sessionId={sessionId} />;
      }

      const view = render(
        () => (
          <TestProviders>
            <TestApp />
          </TestProviders>
        ),
        { container }
      );

      const actions = extractStoreActions(storeContext!);
      await applyFixture(fixture, actions);
      await flushReactive();

      if (fixture.expectedBehavior.assistantContentVisible) {
        expectAssistantContentVisible(container);
      }

      view.unmount();
    });

    it("typing indicator respects content-priority rule", async () => {
      const [sessionId] = createSignal(fixture.sessionId);

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
        return <ChatMessageList sessionId={sessionId} />;
      }

      const view = render(
        () => (
          <TestProviders>
            <TestApp />
          </TestProviders>
        ),
        { container }
      );

      const actions = extractStoreActions(storeContext!);
      await applyFixture(fixture, actions);
      await flushReactive();

      if (fixture.expectedBehavior.typingIndicatorVisible) {
        expectTypingIndicatorVisible(container);
      } else {
        expectTypingIndicatorHidden(container);
      }

      view.unmount();
    });
  });

  describe("Content-Priority Typing Indicator", () => {
    it("hides typing when text content arrives", async () => {
      const SESSION_ID = "test-session-typing";
      const USER_MSG_ID = "user-msg-1";
      const ASSISTANT_MSG_ID = "assistant-msg-1";
      const PART_ID = "part-1";

      const [sessionId] = createSignal(SESSION_ID);

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
        return <ChatMessageList sessionId={sessionId} />;
      }

      const view = render(
        () => (
          <TestProviders>
            <TestApp />
          </TestProviders>
        ),
        { container }
      );

      const actions = extractStoreActions(storeContext!);

      // Create session first (required by store validation)
      actions.session.upsert({
        sessionID: SESSION_ID,
        directory: "/test",
      });

      // Setup: User message + Assistant message + busy status
      actions.message.upsert({
        id: USER_MSG_ID,
        role: "user",
        sessionID: SESSION_ID,
        content: "Hello",
        time: { created: Date.now() },
      });

      actions.message.upsert({
        id: ASSISTANT_MSG_ID,
        role: "assistant",
        sessionID: SESSION_ID,
        parentID: USER_MSG_ID,
        time: { created: Date.now() },
      });

      actions.session.setStatus(SESSION_ID, { type: "busy" });

      await flushReactive();

      // Should show typing (generating but no content yet)
      expectTypingIndicatorVisible(container);

      // Add text part
      actions.part.upsert({
        id: PART_ID,
        type: "text",
        messageID: ASSISTANT_MSG_ID,
        text: "Hello! I can help you.",
      });

      await flushReactive();

      // Should hide typing (content exists)
      expectTypingIndicatorHidden(container);

      view.unmount();
    });

    it("hides typing when tool call content arrives", async () => {
      const SESSION_ID = "test-session-tool";
      const USER_MSG_ID = "user-msg-2";
      const ASSISTANT_MSG_ID = "assistant-msg-2";
      const PART_ID = "part-tool-1";

      const [sessionId] = createSignal(SESSION_ID);

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
        return <ChatMessageList sessionId={sessionId} />;
      }

      const view = render(
        () => (
          <TestProviders>
            <TestApp />
          </TestProviders>
        ),
        { container }
      );

      const actions = extractStoreActions(storeContext!);

      // Create session first (required by store validation)
      actions.session.upsert({
        sessionID: SESSION_ID,
        directory: "/test",
      });

      // Setup
      actions.message.upsert({
        id: USER_MSG_ID,
        role: "user",
        sessionID: SESSION_ID,
        content: "Read file",
        time: { created: Date.now() },
      });

      actions.message.upsert({
        id: ASSISTANT_MSG_ID,
        role: "assistant",
        sessionID: SESSION_ID,
        parentID: USER_MSG_ID,
        time: { created: Date.now() },
      });

      actions.session.setStatus(SESSION_ID, { type: "busy" });

      await flushReactive();

      // Should show typing
      expectTypingIndicatorVisible(container);

      // Add tool call part
      actions.part.upsert({
        id: PART_ID,
        type: "tool-call",
        messageID: ASSISTANT_MSG_ID,
        toolCallId: "call_123",
        toolName: "read_file",
        args: { path: "/test.txt" },
      });

      await flushReactive();

      // Should hide typing (tool call counts as content)
      expectTypingIndicatorHidden(container);

      view.unmount();
    });
  });
});
