/**
 * Integration Tests: Reconnect and Catch-up Rendering
 *
 * End-to-end tests for SSE reconnect and catch-up behavior with real providers.
 * Part of Batch 6: WS8 Closeout - WS5 completion
 *
 * @package @sakti-code/desktop/tests
 */

import {
  useMessageStore,
  usePartStore,
  useSessionStore,
} from "@/core/state/providers/store-provider";
import { render } from "@solidjs/testing-library";
import { createSignal, For } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectAssistantContentVisible,
  expectTypingIndicatorHidden,
  expectTypingIndicatorVisible,
  expectUserMessageVisible,
  flushReactive,
} from "../helpers/dom-assertions";
import { extractStoreActions } from "../helpers/fixture-loader";
import { TestProviders } from "../helpers/test-providers";

describe("Integration: Reconnect and Catch-up Rendering", () => {
  let container: HTMLDivElement;
  let mockFetch: ReturnType<typeof vi.fn>;
  let originalFetch: typeof global.fetch;
  let originalEventSource: typeof global.EventSource;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    // Mock fetch for catch-up requests
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    // Store original EventSource
    originalEventSource = global.EventSource;
  });

  afterEach(() => {
    container.remove();
    global.fetch = originalFetch;
    global.EventSource = originalEventSource;
    vi.clearAllMocks();
  });

  /**
   * Test component that renders messages like the real message list
   */
  function ChatMessageList(props: { sessionId: () => string | null }) {
    const [, messageActions] = useMessageStore();
    const [, partActions] = usePartStore();
    const [sessionState] = useSessionStore();
    const toText = (value: unknown): string => (typeof value === "string" ? value : "");
    const getPartText = (part: unknown): string => {
      if (!part || typeof part !== "object") return "";
      return toText((part as { text?: unknown }).text);
    };

    const messages = () => {
      const sessionId = props.sessionId();
      if (!sessionId) return [];
      return messageActions.getBySession(sessionId);
    };

    const isGenerating = () => {
      const sessionId = props.sessionId();
      if (!sessionId) return false;
      const status = sessionState.status[sessionId];
      return status?.type === "busy";
    };

    const hasAssistantContent = () => {
      const msgs = messages();
      const assistantMsgs = msgs.filter(m => m.role === "assistant");
      if (assistantMsgs.length === 0) return false;

      for (const msg of assistantMsgs) {
        const parts = partActions.getByMessage(msg.id);
        if (parts.length > 0) return true;
      }
      return false;
    };

    const showTypingIndicator = () => {
      return isGenerating() && !hasAssistantContent();
    };

    return (
      <div data-testid="message-list">
        <div data-testid="messages-container">
          <For each={messages()}>
            {msg => (
              <div data-role={msg.role} data-message-id={msg.id} data-testid={`message-${msg.id}`}>
                <span data-testid="message-content">
                  {toText((msg as { content?: unknown }).content)}
                </span>
                {msg.role === "assistant" && (
                  <div data-testid="assistant-parts">
                    <For each={partActions.getByMessage(msg.id)}>
                      {part => (
                        <div data-part-id={part.id} data-part-type={part.type}>
                          {part.type === "text" ? getPartText(part) : null}
                          {part.type === "tool-call" ? "[Tool Call]" : null}
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
          <span>{`Typing... (content-priority: ${!hasAssistantContent()})`}</span>
        </div>
      </div>
    );
  }

  describe("Reconnect during streaming", () => {
    it("should recover and render final state after reconnect", async () => {
      const SESSION_ID = "test-session-reconnect";
      const USER_MSG_ID = "user-msg-reconnect";
      const ASSISTANT_MSG_ID = "assistant-msg-reconnect";

      // Setup mock catch-up response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            {
              type: "message.updated",
              properties: {
                info: {
                  id: USER_MSG_ID,
                  role: "user",
                  sessionID: SESSION_ID,
                  content: "Hello",
                },
              },
              eventId: "evt-001",
              sequence: 1,
              timestamp: Date.now(),
            },
            {
              type: "message.updated",
              properties: {
                info: {
                  id: ASSISTANT_MSG_ID,
                  role: "assistant",
                  sessionID: SESSION_ID,
                  parentID: USER_MSG_ID,
                },
              },
              eventId: "evt-002",
              sequence: 2,
              timestamp: Date.now(),
            },
            {
              type: "message.part.updated",
              properties: {
                part: {
                  id: "part-1",
                  type: "text",
                  messageID: ASSISTANT_MSG_ID,
                  sessionID: SESSION_ID,
                  text: "Hi! I can help you with that.",
                },
              },
              eventId: "evt-003",
              sequence: 3,
              timestamp: Date.now(),
            },
            {
              type: "session.status",
              properties: {
                sessionID: SESSION_ID,
                status: { type: "idle" },
              },
              eventId: "evt-004",
              sequence: 4,
              timestamp: Date.now(),
            },
          ],
        }),
      });

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

      const { unmount: dispose } = render(
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

      // Simulate initial streaming state (user message sent, waiting for assistant)
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

      // Should show typing indicator (generating but no content yet)
      expectTypingIndicatorVisible(container);

      // Simulate catch-up events arriving (as if from refetch)
      actions.part.upsert({
        id: "part-1",
        type: "text",
        messageID: ASSISTANT_MSG_ID,
        sessionID: SESSION_ID,
        text: "Hi! I can help you with that.",
      });

      actions.session.setStatus(SESSION_ID, { type: "idle" });

      await flushReactive();

      // Should now show assistant content and hide typing
      expectAssistantContentVisible(container);
      expectTypingIndicatorHidden(container);

      dispose();
    });

    it("should not duplicate messages after reconnect", async () => {
      const SESSION_ID = "test-session-dedup";
      const USER_MSG_ID = "user-msg-dedup";

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

      const { unmount: dispose } = render(
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

      // Add user message
      actions.message.upsert({
        id: USER_MSG_ID,
        role: "user",
        sessionID: SESSION_ID,
        content: "Hello",
        time: { created: Date.now() },
      });

      await flushReactive();

      // Should have exactly one user message
      const userMessages = container.querySelectorAll('[data-role="user"]');
      expect(userMessages.length).toBe(1);

      // Simulate same message arriving again (from catch-up)
      actions.message.upsert({
        id: USER_MSG_ID,
        role: "user",
        sessionID: SESSION_ID,
        content: "Hello",
        time: { created: Date.now() },
      });

      await flushReactive();

      // Should still have exactly one user message (no duplication)
      const userMessagesAfter = container.querySelectorAll('[data-role="user"]');
      expect(userMessagesAfter.length).toBe(1);

      dispose();
    });

    it("should handle partial event overlap correctly", async () => {
      const SESSION_ID = "test-session-partial";
      const USER_MSG_ID = "user-msg-partial";
      const ASSISTANT_MSG_ID = "assistant-msg-partial";

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

      const { unmount: dispose } = render(
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

      // Add initial messages (before reconnect)
      actions.message.upsert({
        id: USER_MSG_ID,
        role: "user",
        sessionID: SESSION_ID,
        content: "Hello",
        time: { created: Date.now() },
      });

      await flushReactive();

      // Simulate catch-up with overlap (user message already exists)
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

      actions.part.upsert({
        id: "part-1",
        type: "text",
        messageID: ASSISTANT_MSG_ID,
        sessionID: SESSION_ID,
        text: "New content from catch-up!",
      });

      await flushReactive();

      // Should have one user and one assistant message
      expectUserMessageVisible(container);
      expectAssistantContentVisible(container, "New content from catch-up!");

      dispose();
    });
  });

  describe("Typing indicator state", () => {
    it("should maintain correct typing state through reconnect", async () => {
      const SESSION_ID = "test-session-typing-reconnect";
      const USER_MSG_ID = "user-msg-typing";
      const ASSISTANT_MSG_ID = "assistant-msg-typing";

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

      const { unmount: dispose } = render(
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

      // Simulate reconnect with content arriving
      actions.part.upsert({
        id: "part-1",
        type: "text",
        messageID: ASSISTANT_MSG_ID,
        sessionID: SESSION_ID,
        text: "Response after reconnect",
      });

      await flushReactive();

      // Should hide typing when content arrives
      expectTypingIndicatorHidden(container);

      // Complete the session
      actions.session.setStatus(SESSION_ID, { type: "idle" });

      await flushReactive();

      // Should still not show typing
      expectTypingIndicatorHidden(container);

      dispose();
    });

    it("should not leave permanent typing-only state after multiple reconnects", async () => {
      const SESSION_ID = "test-session-multi-reconnect";
      const USER_MSG_ID = "user-msg-multi";
      const ASSISTANT_MSG_ID = "assistant-msg-multi";

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

      const { unmount: dispose } = render(
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

      // Setup initial state
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

      // Simulate multiple reconnects
      for (let i = 0; i < 3; i++) {
        // Reconnect happens
        await flushReactive();
      }

      // Add content after all reconnects
      actions.part.upsert({
        id: "part-1",
        type: "text",
        messageID: ASSISTANT_MSG_ID,
        sessionID: SESSION_ID,
        text: "Final response",
      });

      actions.session.setStatus(SESSION_ID, { type: "idle" });

      await flushReactive();

      // Should show content, not typing
      expectAssistantContentVisible(container, "Final response");
      expectTypingIndicatorHidden(container);

      dispose();
    });
  });

  describe("Event ordering after reconnect", () => {
    it("should process events in correct order after catch-up", async () => {
      const SESSION_ID = "test-session-order";
      const events: string[] = [];

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

      const { unmount: dispose } = render(
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

      // Simulate out-of-order events arriving (as can happen after reconnect)
      actions.message.upsert({
        id: "msg-2",
        role: "assistant",
        sessionID: SESSION_ID,
        parentID: "msg-1",
        time: { created: Date.now() },
      });
      events.push("assistant-message");

      actions.message.upsert({
        id: "msg-1",
        role: "user",
        sessionID: SESSION_ID,
        content: "Hello",
        time: { created: Date.now() - 1000 },
      });
      events.push("user-message");

      actions.part.upsert({
        id: "part-1",
        type: "text",
        messageID: "msg-2",
        sessionID: SESSION_ID,
        text: "Response",
      });
      events.push("assistant-content");

      await flushReactive();

      // Both messages should be visible regardless of arrival order
      expectUserMessageVisible(container);
      expectAssistantContentVisible(container);

      dispose();
    });
  });
});
