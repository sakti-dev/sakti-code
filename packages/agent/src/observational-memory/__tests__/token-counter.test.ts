import { describe, expect, it } from "vitest";

import type { AgentMessage } from "../../types.ts";
import { TokenCounter } from "../token-counter.ts";

describe("TokenCounter", () => {
  const counter = new TokenCounter();

  describe("countString", () => {
    it("returns 0 for empty string", () => {
      expect(counter.countString("")).toBe(0);
    });

    it("returns deterministic results for fixed strings", () => {
      const input = "Hello, this is a test string for token counting.";
      const first = counter.countString(input);
      const second = counter.countString(input);
      expect(first).toBe(second);
      expect(first).toBeGreaterThan(0);
    });

    it("returns different counts for different strings", () => {
      const short = "Hi";
      const long = "This is a much longer string that should have more tokens than the short one.";
      expect(counter.countString(long)).toBeGreaterThan(counter.countString(short));
    });
  });

  describe("countMessage", () => {
    it("counts user message with string content", () => {
      const msg: AgentMessage = {
        role: "user",
        content: "Hello, world!",
        timestamp: Date.now(),
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(0);
    });

    it("counts user message with array content", () => {
      const msg: AgentMessage = {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ],
        timestamp: Date.now(),
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(0);
    });

    it("counts assistant message with text and tool calls", () => {
      const msg: AgentMessage = {
        role: "assistant",
        content: [
          { type: "text", text: "Let me help you with that." },
          { type: "toolCall", id: "tc-1", name: "read_file", arguments: { path: "/tmp/test.ts" } },
        ],
        api: "ai-sdk",
        model: "test-model",
        provider: "test",
        stopReason: "toolUse",
        timestamp: Date.now(),
        usage: {
          input: 10,
          output: 20,
          totalTokens: 30,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(0);
    });

    it("never returns a negative count for many parallel tool calls (M7)", () => {
      // Each toolCall subtracts 12 from the message overhead; with enough
      // parallel calls the overhead goes negative and the estimate must
      // still floor at 0 rather than report nonsense negative tokens.
      const toolCalls = Array.from({ length: 12 }, (_, i) => ({
        type: "toolCall" as const,
        id: `tc-${i}`,
        name: "read_file",
        arguments: { path: `/tmp/${i}.ts` },
      }));
      const msg: AgentMessage = {
        role: "assistant",
        content: toolCalls,
        api: "ai-sdk",
        model: "test-model",
        provider: "test",
        stopReason: "toolUse",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          totalTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      expect(counter.countMessage(msg)).toBeGreaterThanOrEqual(0);
    });

    it("counts tool result message", () => {
      const msg: AgentMessage = {
        role: "toolResult",
        content: [{ type: "text", text: "File contents here" }],
        toolCallId: "tc-1",
        toolName: "read_file",
        isError: false,
        timestamp: Date.now(),
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(0);
    });

    it("counts bash execution message", () => {
      const msg: AgentMessage = {
        role: "bashExecution",
        command: "ls -la",
        output: "total 0\ndrwxr-xr-x  2 user  staff  64 Jan  1 00:00 .",
        exitCode: 0,
        truncated: false,
        cancelled: false,
        timestamp: Date.now(),
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(0);
    });

    it("counts custom message", () => {
      const msg: AgentMessage = {
        role: "custom",
        content: "Custom content here",
        customType: "test",
        display: false,
        timestamp: Date.now(),
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(0);
    });

    it("counts branch summary message", () => {
      const msg: AgentMessage = {
        role: "branchSummary",
        fromId: "msg-1",
        summary: "Branch summary content",
        timestamp: Date.now(),
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(0);
    });

    it("user message with image part yields positive token count", () => {
      // 1x1 red PNG
      const tinyPng =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const msg: AgentMessage = {
        role: "user",
        content: [
          { type: "text", text: "Look at this image:" },
          { type: "image", data: tinyPng, mimeType: "image/png" },
        ],
        timestamp: Date.now(),
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(0);
    });

    it("deterministic across calls", () => {
      const msg: AgentMessage = {
        role: "user",
        content: "Deterministic test message",
        timestamp: Date.now(),
      };
      const first = counter.countMessage(msg);
      const second = counter.countMessage(msg);
      expect(first).toBe(second);
    });
  });

  describe("countMessages", () => {
    it("returns 0 for empty array", () => {
      expect(counter.countMessages([])).toBe(0);
    });

    it("returns deterministic results", () => {
      const msgs: AgentMessage[] = [
        { role: "user", content: "Hello", timestamp: 1 },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi there!" }],
          api: "ai-sdk",
          model: "m",
          provider: "p",
          stopReason: "stop",
          timestamp: 2,
          usage: {
            input: 0,
            output: 0,
            totalTokens: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      ];
      const first = counter.countMessages(msgs);
      const second = counter.countMessages(msgs);
      expect(first).toBe(second);
      expect(first).toBeGreaterThan(0);
    });

    it("total is greater than sum of individual counts (conversation overhead)", () => {
      const msgs: AgentMessage[] = [{ role: "user", content: "Test", timestamp: 1 }];
      const total = counter.countMessages(msgs);
      const individual = counter.countMessage(msgs[0]!);
      // total = TOKENS_PER_CONVERSATION + individual
      expect(total).toBeGreaterThan(individual);
    });
  });

  describe("countObservations", () => {
    it("counts observation string tokens", () => {
      const obs = "* (14:30) User prefers TypeScript\n* (14:35) Working on auth feature";
      const count = counter.countObservations(obs);
      expect(count).toBeGreaterThan(0);
    });

    it("returns 0 for empty string", () => {
      expect(counter.countObservations("")).toBe(0);
    });
  });

  describe("runWithModelContext", () => {
    it("runs function with model context", () => {
      const result = counter.runWithModelContext({ provider: "openai", modelId: "gpt-4o" }, () => {
        return counter.countString("test");
      });
      expect(result).toBeGreaterThan(0);
    });

    it("nests model contexts", () => {
      const outer = counter.runWithModelContext({ provider: "openai" }, () => {
        return counter.runWithModelContext({ provider: "anthropic" }, () => {
          return counter.countString("nested");
        });
      });
      expect(outer).toBeGreaterThan(0);
    });

    it("returns function return value", () => {
      const result = counter.runWithModelContext(undefined, () => 42);
      expect(result).toBe(42);
    });
  });

  describe("constructor", () => {
    it("accepts string model", () => {
      const c = new TokenCounter({ model: "openai/gpt-4o" });
      expect(c.countString("test")).toBeGreaterThan(0);
    });

    it("accepts model context object", () => {
      const c = new TokenCounter({ model: { provider: "openai", modelId: "gpt-4o" } });
      expect(c.countString("test")).toBeGreaterThan(0);
    });

    it("works without options", () => {
      const c = new TokenCounter();
      expect(c.countString("test")).toBeGreaterThan(0);
    });
  });
});
