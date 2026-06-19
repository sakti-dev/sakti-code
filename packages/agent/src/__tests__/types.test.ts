import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../types";

describe("AgentMessage type", () => {
  it("user message has role 'user' and content string", () => {
    const msg: AgentMessage = {
      role: "user",
      content: "Hello, world",
      timestamp: Date.now(),
    };
    expect(msg.role).toBe("user");
    if (msg.role === "user") {
      expect(typeof msg.content).toBe("string");
    }
  });

  it("assistant message has role 'assistant', content, optional toolCalls and usage", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "I'll help you." }],
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: Date.now(),
    };
    expect(msg.role).toBe("assistant");
    if (msg.role === "assistant") {
      expect(msg.content[0]!.type).toBe("text");
      expect(msg.usage).toBeDefined();
    }
  });

  it("assistant message with tool calls", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "tc_1", name: "read", arguments: { path: "src/index.ts" } },
      ],
      usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: Date.now(),
    };
    if (msg.role === "assistant") {
      const tc = msg.content.find((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall");
      expect(tc).toBeDefined();
      expect(tc!.name).toBe("read");
    }
  });

  it("tool result message has role 'tool', toolCallId, content, and isError", () => {
    const msg: AgentMessage = {
      role: "tool",
      toolCallId: "tc_1",
      toolName: "read",
      content: [{ type: "text", text: "file contents here" }],
      isError: false,
      timestamp: Date.now(),
    };
    expect(msg.role).toBe("tool");
    if (msg.role === "tool") {
      expect(msg.toolCallId).toBe("tc_1");
      expect(msg.isError).toBe(false);
    }
  });

  it("tool result message with error", () => {
    const msg: AgentMessage = {
      role: "tool",
      toolCallId: "tc_1",
      toolName: "read",
      content: [{ type: "text", text: "File not found" }],
      isError: true,
      timestamp: Date.now(),
    };
    if (msg.role === "tool") {
      expect(msg.isError).toBe(true);
    }
  });

  it("discriminated union narrows correctly", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi", timestamp: 0 },
      { role: "assistant", content: [{ type: "text", text: "hello" }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 0 },
      { role: "tool", toolCallId: "tc_1", toolName: "bash", content: [{ type: "text", text: "done" }], isError: false, timestamp: 0 },
    ];
    for (const msg of messages) {
      switch (msg.role) {
        case "user": expect(typeof msg.content).toBe("string"); break;
        case "assistant": expect(Array.isArray(msg.content)).toBe(true); expect(msg.usage).toBeDefined(); break;
        case "tool": expect(msg.toolCallId).toBeDefined(); break;
      }
    }
  });

  it("isAgentMessage runtime guard validates structure", async () => {
    const { isAgentMessage } = await import("../types");
    expect(isAgentMessage({ role: "user", content: "hi", timestamp: 0 })).toBe(true);
    expect(isAgentMessage({ role: "assistant", content: [{ type: "text", text: "ok" }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 0 })).toBe(true);
    expect(isAgentMessage({ role: "tool", toolCallId: "tc_1", toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 0 })).toBe(true);
    expect(isAgentMessage({ role: "user" })).toBe(false);
    expect(isAgentMessage(null)).toBe(false);
    expect(isAgentMessage({})).toBe(false);
  });
});
