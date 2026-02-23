import {
  StoreProvider,
  useMessageStore,
  usePartStore,
  useSessionStore,
} from "@/core/state/providers/store-provider";
import type { MessageWithId } from "@/core/state/stores/message-store";
import { render } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("StoreProvider - Strict Provider Hierarchy", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  describe("Hook Usage Outside Provider", () => {
    it("throws when useMessageStore is called outside StoreProvider", () => {
      expect(() => {
        createRoot(() => {
          useMessageStore();
        });
      }).toThrow("useStores must be used within StoreProvider");
    });

    it("throws when usePartStore is called outside StoreProvider", () => {
      expect(() => {
        createRoot(() => {
          usePartStore();
        });
      }).toThrow("useStores must be used within StoreProvider");
    });

    it("throws when useSessionStore is called outside StoreProvider", () => {
      expect(() => {
        createRoot(() => {
          useSessionStore();
        });
      }).toThrow("useStores must be used within StoreProvider");
    });
  });

  describe("Provider Isolation", () => {
    it("creates isolated stores per provider instance", () => {
      let store1: ReturnType<typeof useMessageStore> | undefined;
      let store2: ReturnType<typeof useMessageStore> | undefined;
      let sessionStore1: ReturnType<typeof useSessionStore> | undefined;

      const TestComponent1 = () => {
        store1 = useMessageStore();
        sessionStore1 = useSessionStore();
        return <div>test1</div>;
      };

      const TestComponent2 = () => {
        store2 = useMessageStore();
        return <div>test2</div>;
      };

      // Create two separate provider trees
      ({ unmount: dispose } = render(() => (
        <div>
          <StoreProvider>
            <TestComponent1 />
          </StoreProvider>
          <StoreProvider>
            <TestComponent2 />
          </StoreProvider>
        </div>
      )));
      // Verify stores are accessible
      expect(store1).toBeDefined();
      expect(store2).toBeDefined();

      // Add message to first store
      const [state1, actions1] = store1!;
      const [, sessionActions1] = sessionStore1!;
      sessionActions1.upsert({ sessionID: "session-1", directory: "/tmp/test-1" });
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        content: "Hello from store 1",
        sessionID: "session-1",
        time: Date.now(),
      };
      actions1.upsert(message);

      // Verify second store is unaffected
      const [state2] = store2!;
      expect(Object.keys(state1.byId)).toHaveLength(1);
      expect(state1.byId["msg-1"]).toBeDefined();
      expect(Object.keys(state2.byId)).toHaveLength(0);
    });

    it("maintains independent state across multiple provider instances", () => {
      let storeA: ReturnType<typeof useMessageStore> | undefined;
      let storeB: ReturnType<typeof useMessageStore> | undefined;
      let sessionStoreA: ReturnType<typeof useSessionStore> | undefined;
      let sessionStoreB: ReturnType<typeof useSessionStore> | undefined;

      const ComponentA = () => {
        storeA = useMessageStore();
        sessionStoreA = useSessionStore();
        return <div>A</div>;
      };

      const ComponentB = () => {
        storeB = useMessageStore();
        sessionStoreB = useSessionStore();
        return <div>B</div>;
      };

      ({ unmount: dispose } = render(() => (
        <div>
          <StoreProvider>
            <ComponentA />
          </StoreProvider>
          <StoreProvider>
            <ComponentB />
          </StoreProvider>
        </div>
      )));
      expect(storeA).toBeDefined();
      expect(storeB).toBeDefined();

      const [, actionsA] = storeA!;
      const [, actionsB] = storeB!;
      const [, sessionActionsA] = sessionStoreA!;
      const [, sessionActionsB] = sessionStoreB!;

      sessionActionsA.upsert({ sessionID: "session-a", directory: "/tmp/a" });
      sessionActionsB.upsert({ sessionID: "session-b", directory: "/tmp/b" });

      // Add different messages to each store
      actionsA.upsert({
        id: "msg-a",
        role: "user",
        content: "Message A",
        sessionID: "session-a",
        time: Date.now(),
      });

      actionsB.upsert({
        id: "msg-b",
        role: "assistant",
        content: "Message B",
        sessionID: "session-b",
        time: Date.now(),
      });

      const [stateA] = storeA!;
      const [stateB] = storeB!;

      // Verify isolation
      expect(Object.keys(stateA.byId)).toHaveLength(1);
      expect(stateA.byId["msg-a"]).toBeDefined();
      expect(Object.keys(stateB.byId)).toHaveLength(1);
      expect(stateB.byId["msg-b"]).toBeDefined();
    });
  });

  describe("Store Operations Within Provider", () => {
    it("allows message store operations within StoreProvider", () => {
      let messageStore: ReturnType<typeof useMessageStore> | undefined;
      let sessionStore: ReturnType<typeof useSessionStore> | undefined;

      const TestComponent = () => {
        messageStore = useMessageStore();
        sessionStore = useSessionStore();
        return <div>test</div>;
      };

      ({ unmount: dispose } = render(() => (
        <StoreProvider>
          <TestComponent />
        </StoreProvider>
      )));
      expect(messageStore).toBeDefined();

      const [state, actions] = messageStore!;
      const [, sessionActions] = sessionStore!;
      sessionActions.upsert({ sessionID: "session-1", directory: "/tmp/test" });

      // Test upsert
      actions.upsert({
        id: "msg-1",
        role: "user",
        content: "Test message",
        sessionID: "session-1",
        time: Date.now(),
      });

      expect(Object.keys(state.byId)).toHaveLength(1);
      expect(state.byId["msg-1"].content).toBe("Test message");

      // Test getById
      const retrieved = actions.getById("msg-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe("Test message");

      // Test getBySession
      const sessionMessages = actions.getBySession("session-1");
      expect(sessionMessages).toHaveLength(1);

      // Test remove
      actions.remove("msg-1");
      expect(Object.keys(state.byId)).toHaveLength(0);
    });

    it("allows part store operations within StoreProvider", () => {
      let partStore: ReturnType<typeof usePartStore> | undefined;
      let messageStore: ReturnType<typeof useMessageStore> | undefined;
      let sessionStore: ReturnType<typeof useSessionStore> | undefined;

      const TestComponent = () => {
        partStore = usePartStore();
        messageStore = useMessageStore();
        sessionStore = useSessionStore();
        return <div>test</div>;
      };

      ({ unmount: dispose } = render(() => (
        <StoreProvider>
          <TestComponent />
        </StoreProvider>
      )));
      expect(partStore).toBeDefined();

      const [state, actions] = partStore!;
      const [, messageActions] = messageStore!;
      const [, sessionActions] = sessionStore!;

      sessionActions.upsert({ sessionID: "session-1", directory: "/tmp/test" });
      messageActions.upsert({
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
        time: Date.now(),
      });

      // Test upsert
      actions.upsert({
        id: "part-1",
        type: "text",
        messageID: "msg-1",
        text: "Test part",
        time: Date.now(),
      });

      expect(Object.keys(state.byId)).toHaveLength(1);
      expect(state.byId["part-1"].text).toBe("Test part");

      // Test getByMessage
      const messageParts = actions.getByMessage("msg-1");
      expect(messageParts).toHaveLength(1);
    });

    it("allows session store operations within StoreProvider", () => {
      let sessionStore: ReturnType<typeof useSessionStore> | undefined;

      const TestComponent = () => {
        sessionStore = useSessionStore();
        return <div>test</div>;
      };

      ({ unmount: dispose } = render(() => (
        <StoreProvider>
          <TestComponent />
        </StoreProvider>
      )));
      expect(sessionStore).toBeDefined();

      const [state, actions] = sessionStore!;

      // Test upsert (session uses sessionID, not id)
      actions.upsert({
        sessionID: "session-1",
        directory: "/tmp/test",
      });

      expect(Object.keys(state.byId)).toHaveLength(1);
      expect(state.byId["session-1"].directory).toBe("/tmp/test");

      // Test getByDirectory
      const sessions = actions.getByDirectory("/tmp/test");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionID).toBe("session-1");

      // Test setStatus
      actions.setStatus("session-1", { type: "busy" });
      expect(state.status["session-1"]?.type).toBe("busy");

      // Test getStatus
      expect(actions.getStatus("session-1")).toEqual({ type: "busy" });
    });
  });

  describe("Multiple Hook Usage in Same Component", () => {
    it("allows using all store hooks in the same component", () => {
      let msgStore: ReturnType<typeof useMessageStore> | undefined;
      let partStore: ReturnType<typeof usePartStore> | undefined;
      let sessStore: ReturnType<typeof useSessionStore> | undefined;

      const TestComponent = () => {
        msgStore = useMessageStore();
        partStore = usePartStore();
        sessStore = useSessionStore();
        return <div>test</div>;
      };

      ({ unmount: dispose } = render(() => (
        <StoreProvider>
          <TestComponent />
        </StoreProvider>
      )));
      expect(msgStore).toBeDefined();
      expect(partStore).toBeDefined();
      expect(sessStore).toBeDefined();

      // Verify all stores are from the same provider
      const [, msgActions] = msgStore!;
      const [, partActions] = partStore!;
      const [, sessActions] = sessStore!;

      sessActions.upsert({
        sessionID: "session-1",
        directory: "/tmp/test",
      });

      // Add data to each store
      msgActions.upsert({
        id: "msg-1",
        role: "user",
        content: "Message",
        sessionID: "session-1",
        time: Date.now(),
      });

      partActions.upsert({
        id: "part-1",
        type: "text",
        messageID: "msg-1",
        text: "Part text",
        time: Date.now(),
      });

      // Verify all stores have data
      const [msgState] = msgStore!;
      const [partState] = partStore!;
      const [sessState] = sessStore!;

      expect(Object.keys(msgState.byId)).toHaveLength(1);
      expect(Object.keys(partState.byId)).toHaveLength(1);
      expect(Object.keys(sessState.byId)).toHaveLength(1);
    });
  });

  describe("Global Fallback Removal", () => {
    it("does not share context between separate provider instances", () => {
      let store1: ReturnType<typeof useMessageStore> | undefined;
      let store2: ReturnType<typeof useMessageStore> | undefined;
      let sessionStore1: ReturnType<typeof useSessionStore> | undefined;

      const TestComponent1 = () => {
        store1 = useMessageStore();
        sessionStore1 = useSessionStore();
        return <div>test1</div>;
      };

      const TestComponent2 = () => {
        store2 = useMessageStore();
        return <div>test2</div>;
      };

      // Create first provider and add data
      const { unmount: dispose1 } = render(() => (
        <StoreProvider>
          <TestComponent1 />
        </StoreProvider>
      ));

      const [, actions1] = store1!;
      const [, sessionActions1] = sessionStore1!;
      sessionActions1.upsert({ sessionID: "session-1", directory: "/tmp/test-1" });
      actions1.upsert({
        id: "msg-1",
        role: "user",
        content: "First provider message",
        sessionID: "session-1",
        time: Date.now(),
      });

      // Create second provider in same container
      const { unmount: dispose2 } = render(() => (
        <StoreProvider>
          <TestComponent2 />
        </StoreProvider>
      ));

      // If global context sharing exists, store2 would see store1's data
      const [state2] = store2!;
      expect(Object.keys(state2.byId)).toHaveLength(0);

      // Cleanup
      dispose1();
      dispose2();
    });

    it("does not allow hooks to access global fallback stores", () => {
      // This test verifies that the global fallback has been removed
      // If the fallback exists, this would not throw
      expect(() => {
        createRoot(() => {
          useMessageStore();
        });
      }).toThrow("useStores must be used within StoreProvider");
    });
  });
});
