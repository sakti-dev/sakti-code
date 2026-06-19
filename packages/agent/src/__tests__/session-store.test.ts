import { describe, expect, it } from "vitest";
import type { AgentMessage, SessionStore } from "../types";

describe("SessionStore interface", () => {
  it("mock SessionStore satisfies the interface and works correctly", async () => {
    const store: SessionStore = (() => {
      const messages: Map<string, AgentMessage[]> = new Map();
      return {
        async loadMessages(sessionId) {
          return messages.get(sessionId) ?? [];
        },
        async appendMessage(sessionId, message) {
          const list = messages.get(sessionId) ?? [];
          list.push(message);
          messages.set(sessionId, list);
        },
        async replaceMessages(sessionId, newMessages) {
          messages.set(sessionId, [...newMessages]);
        },
      };
    })();

    // Empty session returns empty array
    expect(await store.loadMessages("s1")).toEqual([]);

    // Append messages
    const userMsg: AgentMessage = { role: "user", content: "hello", timestamp: 1 };
    await store.appendMessage("s1", userMsg);
    expect((await store.loadMessages("s1")).length).toBe(1);

    const asstMsg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: 2,
    };
    await store.appendMessage("s1", asstMsg);
    expect((await store.loadMessages("s1")).length).toBe(2);

    // Replace atomically
    const replacement: AgentMessage = {
      role: "user",
      content: "summary of previous conversation",
      timestamp: 3,
    };
    await store.replaceMessages("s1", [replacement]);
    const loaded = await store.loadMessages("s1");
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.content).toBe("summary of previous conversation");

    // Multiple sessions don't interfere
    expect(await store.loadMessages("s2")).toEqual([]);
  });
});
