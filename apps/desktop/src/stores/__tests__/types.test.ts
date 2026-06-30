import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { agentMessageToUI, idleStreamState } from "../types.ts";
import {
  makeAssistantMessage,
  makeAssistantMessageWithThinking,
  makeAssistantMessageWithToolCall,
} from "./helpers.ts";

describe("agentMessageToUI — user messages", () => {
  it("converts a user text message", () => {
    const msg = {
      role: "user",
      content: "hello world",
      timestamp: 1000,
    } as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("user");
    expect(ui.content).toBe("hello world");
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toEqual({ type: "text", text: "hello world" });
    expect(ui.isStreaming).toBe(false);
  });

  it("converts user message with array content", () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "part1 " },
        { type: "text", text: "part2" },
      ],
      timestamp: 1000,
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.content).toBe("part1 part2");
  });
});

describe("agentMessageToUI — assistant messages", () => {
  it("converts an assistant message with usage", () => {
    const msg = makeAssistantMessage("hi there", {
      timestamp: 2000,
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        cost: {
          input: 0.001,
          output: 0.002,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.003,
        },
      },
    });

    const ui = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui.role).toBe("assistant");
    expect(ui.usage).toEqual({ input: 100, output: 50, cost: 0.003 });
  });

  it("converts assistant message with array content", () => {
    const msg = makeAssistantMessage("part1 part2");
    const ui = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui.content).toBe("part1 part2");
  });

  it("converts assistant message with empty content", () => {
    const msg = makeAssistantMessage("");
    const ui = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui.content).toBe("");
    // agentMessageToUI always emits a single text part mirroring content,
    // even when empty. (Reducer's handleMessageStart is the one that omits.)
    expect(ui.parts).toEqual([{ type: "text", text: "" }]);
  });

  it("converts assistant message with thinking content (text extracted only)", () => {
    const msg = makeAssistantMessageWithThinking("answer", "thoughts");
    const ui = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui.content).toBe("answer");
  });

  it("converts assistant message with tool call (text extracted only)", () => {
    const msg = makeAssistantMessageWithToolCall("running it", {
      id: "tc1",
      name: "bash",
      args: { command: "ls" },
    });
    const ui = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui.content).toBe("running it");
  });
});

describe("agentMessageToUI — edge cases", () => {
  it("falls back to Date.now() when timestamp missing", () => {
    const before = Date.now();
    const msg = {
      role: "user",
      content: "test",
    } as AgentMessage;
    const after = Date.now();

    const ui = agentMessageToUI(msg);
    expect(ui.timestamp).toBeGreaterThanOrEqual(before);
    expect(ui.timestamp).toBeLessThanOrEqual(after);
  });

  it("converts toolResult role to system message", () => {
    const msg = {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "bash",
      content: [{ type: "text", text: "output" }],
      isError: false,
      timestamp: 1000,
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("system");
    expect(ui.content).toBe("");
    expect(ui.parts).toHaveLength(0);
  });

  it("converts bashExecution role to system message", () => {
    const msg = {
      role: "bashExecution",
      command: "ls",
      output: "file1",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 1000,
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("system");
  });

  it("generates unique IDs for each message", () => {
    const msg = makeAssistantMessage("test");
    const ui1 = agentMessageToUI(msg as unknown as AgentMessage);
    const ui2 = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui1.id).not.toBe(ui2.id);
  });
});

describe("idleStreamState", () => {
  it("starts idle with zero tokens", () => {
    expect(idleStreamState.phase).toBe("idle");
    expect(idleStreamState.tokenCount).toBe(0);
    expect(idleStreamState.currentMessageId).toBeNull();
    expect(idleStreamState.currentToolName).toBeNull();
    expect(idleStreamState.startedAt).toBe(0);
  });
});
