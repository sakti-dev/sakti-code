import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { hydrateSessionMessages } from "../hydrate-messages.ts";

describe("hydrateSessionMessages", () => {
  it("converts user message to UIMessage", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: "hello world",
        timestamp: 1_700_000_000_000,
      } as unknown as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toBe("hello world");
    expect(result[0]!.parts).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("converts assistant message with thinking + text + toolCall", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think" },
          { type: "text", text: "Running bash" },
          {
            type: "toolCall",
            id: "call-1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ],
        timestamp: 1_700_000_000_000,
      } as unknown as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result).toHaveLength(1);
    const msg = result[0]!;
    expect(msg.role).toBe("assistant");
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts[0]!).toEqual({ type: "thinking", text: "Let me think" });
    expect(msg.parts[1]!).toEqual({ type: "text", text: "Running bash" });
    expect(msg.parts[2]!.type).toBe("tool_call");
    expect((msg.parts[2] as { status: string }).status).toBe("running");
  });

  it("merges toolResult into preceding assistant tool_call part", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "edit",
            arguments: { path: "/test.ts" },
          },
        ],
        timestamp: 1_700_000_000_000,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "edit",
        content: [{ type: "text", text: "Edited /test.ts" }],
        details: { diff: "--- old\n+++ new", firstChangedLine: 5 },
        isError: false,
        timestamp: 1_700_000_001_000,
      } as unknown as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result).toHaveLength(1);
    const part = result[0]!.parts[0]!;
    expect(part.type).toBe("tool_call");
    expect((part as { status: string }).status).toBe("done");
    expect((part as { result?: string }).result).toBe("Edited /test.ts");
    expect((part as { details?: unknown }).details).toEqual({
      diff: "--- old\n+++ new",
      firstChangedLine: 5,
    });
  });

  it("marks tool_call as error when toolResult has isError", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "edit",
            arguments: { path: "/test.ts" },
          },
        ],
        timestamp: 1_700_000_000_000,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "edit",
        content: [{ type: "text", text: "Could not find text" }],
        isError: true,
        timestamp: 1_700_000_001_000,
      } as unknown as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    const part = result[0]!.parts[0]!;
    expect((part as { status: string }).status).toBe("error");
  });

  it("preserves full conversation: user → assistant(toolCall) → toolResult → assistant(text)", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: "list files",
        timestamp: 1,
      } as unknown as AgentMessage,
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check" },
          {
            type: "toolCall",
            id: "c1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ],
        timestamp: 2,
      } as unknown as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        content: [{ type: "text", text: "file1\nfile2" }],
        isError: false,
        timestamp: 3,
      } as unknown as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "Found 2 files" }],
        timestamp: 4,
      } as unknown as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result).toHaveLength(3); // user, assistant(with tool), assistant(text)
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.parts).toHaveLength(2); // text + tool_call(done)
    expect(result[2]!.role).toBe("assistant");
    expect(result[2]!.parts).toHaveLength(1); // text only
  });

  it("preserves usage on assistant messages", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        usage: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 150,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
        },
        timestamp: 1_700_000_000_000,
      } as unknown as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result[0]!.usage).toEqual({ input: 100, output: 50, cost: 3 });
  });
});
