import { describe, expect, it } from "vitest";
import { createAgentConfig } from "../types";

describe("AgentConfig type", () => {
  it("accepts model, tools, store, and all settings", () => {
    const store = {
      loadMessages: async () => [],
      appendMessage: async () => {},
      replaceMessages: async () => {},
    };

    const config = createAgentConfig({
      sessionId: "s1",
      model: {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        reasoning: false,
        input: ["text"],
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 200_000,
        maxTokens: 8192,
      },
      tools: [],
      store,
      toolExecutionMode: "parallel",
      maxRetries: 3,
      retryBaseDelayMs: 1000,
      reserveTokens: 16_000,
      keepRecentTokens: 20_000,
    });

    expect(config.sessionId).toBe("s1");
    expect(config.toolExecutionMode).toBe("parallel");
    expect(config.maxRetries).toBe(3);
    expect(config.reserveTokens).toBe(16_000);
  });

  it("defaults toolExecutionMode to parallel", () => {
    const store = {
      loadMessages: async () => [],
      appendMessage: async () => {},
      replaceMessages: async () => {},
    };

    const config = createAgentConfig({
      sessionId: "s1",
      model: {
        id: "x",
        name: "x",
        api: "openai-completions",
        provider: "openai",
        baseUrl: "",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4096,
      },
      tools: [],
      store,
    });

    expect(config.toolExecutionMode).toBe("parallel");
  });

  it("isAgentConfig runtime guard", async () => {
    const { isAgentConfig } = await import("../types");
    const minimal = {
      sessionId: "s1",
      model: {
        id: "x",
        name: "x",
        api: "openai-completions",
        provider: "openai",
        baseUrl: "",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4096,
      },
      tools: [],
      store: {
        loadMessages: async () => [],
        appendMessage: async () => {},
        replaceMessages: async () => {},
      },
    };
    expect(isAgentConfig(minimal)).toBe(true);
    expect(isAgentConfig(null)).toBe(false);
    expect(isAgentConfig({})).toBe(false);
  });
});
