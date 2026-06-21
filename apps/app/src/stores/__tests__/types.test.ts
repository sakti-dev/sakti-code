import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import { agentMessageToUI, idleStreamState } from "../types.ts";

describe("agentMessageToUI", () => {
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

  it("converts an assistant message with usage", () => {
    const msg = {
      role: "assistant",
      content: "hi there",
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
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("assistant");
    expect(ui.usage).toEqual({ input: 100, output: 50, cost: 0.003 });
  });

  it("converts assistant message with array content", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: "part1 " },
        { type: "text", text: "part2" },
      ],
      timestamp: 3000,
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.content).toBe("part1 part2");
  });
});

describe("idleStreamState", () => {
  it("starts idle with zero tokens", () => {
    expect(idleStreamState.phase).toBe("idle");
    expect(idleStreamState.tokenCount).toBe(0);
    expect(idleStreamState.currentMessageId).toBeNull();
  });
});
