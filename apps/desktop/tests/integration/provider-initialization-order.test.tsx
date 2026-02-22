/**
 * Integration Tests: Provider Initialization Order
 *
 * Validates strict provider architecture without global fallbacks.
 * Part of Batch 5: WS7 Testing Overhaul (WS1)
 *
 * @package @sakti-code/desktop/tests
 */

import type { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { ChatProvider, useChatContext } from "@/core/state/contexts/chat-provider";
import {
  useMessageStore,
  usePartStore,
  useSessionStore,
} from "@/core/state/providers/store-provider";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "../helpers/test-providers";

describe("Integration: Provider Initialization Order", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe("Strict Provider Hierarchy", () => {
    it("throws when useMessageStore called outside StoreProvider", () => {
      function ComponentUsingStore() {
        useMessageStore();
        return null;
      }

      expect(() => {
        render(() => <ComponentUsingStore />, { container });
      }).toThrow("useStores must be used within StoreProvider");
    });

    it("throws when usePartStore called outside StoreProvider", () => {
      function ComponentUsingStore() {
        usePartStore();
        return null;
      }

      expect(() => {
        render(() => <ComponentUsingStore />, { container });
      }).toThrow("useStores must be used within StoreProvider");
    });

    it("throws when useSessionStore called outside StoreProvider", () => {
      function ComponentUsingStore() {
        useSessionStore();
        return null;
      }

      expect(() => {
        render(() => <ComponentUsingStore />, { container });
      }).toThrow("useStores must be used within StoreProvider");
    });

    it("throws when useChatContext called outside ChatProvider", () => {
      function ComponentUsingChat() {
        useChatContext();
        return null;
      }

      expect(() => {
        render(
          () => (
            <TestProviders>
              <ComponentUsingChat />
            </TestProviders>
          ),
          { container }
        );
      }).toThrow("useChatContext must be used within ChatProvider");
    });
  });

  describe("Full Provider Tree", () => {
    it("full provider tree mounts without errors", () => {
      const mockClient = {
        chat: vi.fn(),
      } as unknown as SaktiCodeApiClient;

      function TestComponent() {
        const [messageState] = useMessageStore();
        const [partState] = usePartStore();
        const [sessionState] = useSessionStore();

        return (
          <div>
            <span data-testid="messages-count">{Object.keys(messageState.byId).length}</span>
            <span data-testid="parts-count">{Object.keys(partState.byId).length}</span>
            <span data-testid="sessions-count">{Object.keys(sessionState.byId).length}</span>
          </div>
        );
      }

      const [sessionId] = createSignal<string | null>("test-session");
      const [workspace] = createSignal("/test/workspace");

      const { unmount: dispose } = render(
        () => (
          <TestProviders>
            <ChatProvider client={mockClient} workspace={workspace} sessionId={sessionId}>
              <TestComponent />
            </ChatProvider>
          </TestProviders>
        ),
        { container }
      );

      // Should render without errors
      expect(container.querySelector('[data-testid="messages-count"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="parts-count"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="sessions-count"]')).toBeTruthy();

      dispose();
    });

    it("nested providers maintain correct context hierarchy", () => {
      const mockClient = {
        chat: vi.fn(),
      } as unknown as SaktiCodeApiClient;

      function TestComponent() {
        const [messageState] = useMessageStore();
        const [partState] = usePartStore();

        return (
          <div>
            <span data-testid="has-message-store">{messageState ? "true" : "false"}</span>
            <span data-testid="has-part-store">{partState ? "true" : "false"}</span>
          </div>
        );
      }

      const [sessionId] = createSignal<string | null>("test-session");
      const [workspace] = createSignal("/test/workspace");

      const { unmount: dispose } = render(
        () => (
          <TestProviders>
            <ChatProvider client={mockClient} workspace={workspace} sessionId={sessionId}>
              <TestComponent />
            </ChatProvider>
          </TestProviders>
        ),
        { container }
      );

      const hasMessageStore = container.querySelector('[data-testid="has-message-store"]');
      const hasPartStore = container.querySelector('[data-testid="has-part-store"]');

      expect(hasMessageStore?.textContent).toBe("true");
      expect(hasPartStore?.textContent).toBe("true");

      dispose();
    });
  });

  describe("Provider State Isolation", () => {
    it("each StoreProvider instance has isolated state", () => {
      function TestComponent({ prefix }: { prefix: string }) {
        const [, messageActions] = useMessageStore();
        const [, sessionActions] = useSessionStore();

        // Create session first (required by store validation)
        sessionActions.upsert({
          sessionID: `${prefix}-session`,
          directory: "/test",
        });

        // Add a message to this store instance
        messageActions.upsert({
          id: `${prefix}-msg-1`,
          role: "user",
          sessionID: `${prefix}-session`,
          time: { created: Date.now() },
        });

        const [messageState] = useMessageStore();
        return (
          <div data-testid={`${prefix}-messages`}>{Object.keys(messageState.byId).length}</div>
        );
      }

      // Render two separate provider trees
      const container1 = document.createElement("div");
      const container2 = document.createElement("div");
      document.body.appendChild(container1);
      document.body.appendChild(container2);

      const { unmount: dispose1 } = render(
        () => (
          <TestProviders>
            <TestComponent prefix="tree1" />
          </TestProviders>
        ),
        { container: container1 }
      );

      const { unmount: dispose2 } = render(
        () => (
          <TestProviders>
            <TestComponent prefix="tree2" />
          </TestProviders>
        ),
        { container: container2 }
      );

      // Each tree should only have its own messages
      expect(container1.querySelector('[data-testid="tree1-messages"]')?.textContent).toBe("1");
      expect(container2.querySelector('[data-testid="tree2-messages"]')?.textContent).toBe("1");

      dispose1();
      dispose2();
      container1.remove();
      container2.remove();
    });
  });

  describe("Fail-Fast Behavior", () => {
    it("provides clear error message for missing StoreProvider", () => {
      function ComponentUsingStore() {
        useMessageStore();
        return null;
      }

      let errorMessage = "";
      try {
        render(() => <ComponentUsingStore />, { container });
      } catch (error) {
        errorMessage = (error as Error).message;
      }

      expect(errorMessage).toContain("StoreProvider");
      expect(errorMessage).toContain("useStores");
    });

    it("provides clear error message for missing ChatProvider", () => {
      function ComponentUsingChat() {
        useChatContext();
        return null;
      }

      let errorMessage = "";
      try {
        render(
          () => (
            <TestProviders>
              <ComponentUsingChat />
            </TestProviders>
          ),
          { container }
        );
      } catch (error) {
        errorMessage = (error as Error).message;
      }

      expect(errorMessage).toContain("ChatProvider");
      expect(errorMessage).toContain("useChatContext");
    });
  });
});
