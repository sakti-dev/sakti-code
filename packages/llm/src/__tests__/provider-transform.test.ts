import { describe, expect, it } from "vite-plus/test";
import { buildHeaders, buildProviderOptions } from "../provider/transform.ts";
import type { Model, OpenAICompletionsCompat } from "../types.ts";

/** Build a test Model with a specific thinkingFormat + provider name "testprov". */
function modelWith(
  thinkingFormat: OpenAICompletionsCompat["thinkingFormat"],
  overrides: Partial<Model> & { compat?: Partial<OpenAICompletionsCompat> } = {}
): Model {
  const { compat: compatOverrides, ...modelOverrides } = overrides;
  const compat = {
    thinkingFormat,
    ...compatOverrides,
  } as OpenAICompletionsCompat;
  return {
    api: "ai-sdk",
    baseUrl: "https://example.com",
    compat,
    contextWindow: 200_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "test-model",
    input: ["text"],
    maxTokens: 8192,
    name: "Test",
    provider: "testprov",
    reasoning: true,
    ...modelOverrides,
  };
}

/** Shortcut: the inner params object scoped under provider "testprov". */
function inner(result: Record<string, unknown>): Record<string, unknown> {
  return result.testprov as Record<string, unknown>;
}

// ─── early returns ────────────────────────────────────────────────────────

describe("buildProviderOptions — early returns", () => {
  it("returns {} when model has no compat (first-party @ai-sdk)", () => {
    const model: Model = {
      api: "ai-sdk",
      baseUrl: "x",
      contextWindow: 1,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "m",
      input: ["text"],
      maxTokens: 1,
      name: "m",
      provider: "openai",
      reasoning: true,
    };
    expect(buildProviderOptions({ level: "high", model })).toEqual({});
  });

  it("returns {} when model.reasoning is false", () => {
    const model = modelWith("openai", { reasoning: false });
    expect(buildProviderOptions({ level: "high", model })).toEqual({});
  });
});

// ─── one test per thinkingFormat value (3 live formats) ──────────────────

describe("buildProviderOptions — thinkingFormat branches", () => {
  it("openai → reasoning_effort from mapped level", () => {
    const model = modelWith("openai", {
      compat: { supportsReasoningEffort: true },
    });
    const result = inner(buildProviderOptions({ level: "high", model }));
    expect(result).toEqual({ reasoning_effort: "high" });
  });

  it("openai → omits reasoning_effort when supportsReasoningEffort is false", () => {
    const model = modelWith("openai");
    expect(buildProviderOptions({ level: "high", model })).toEqual({});
  });

  it("deepseek → thinking.type enabled + reasoning_effort when supported", () => {
    const model = modelWith("deepseek", {
      compat: { supportsReasoningEffort: true },
    });
    const result = inner(buildProviderOptions({ level: "high", model }));
    expect(result).toEqual({
      reasoning_effort: "high",
      thinking: { type: "enabled" },
    });
  });

  it("zai → thinking.type enabled/disabled + reasoning_effort when supported", () => {
    const model = modelWith("zai", {
      compat: { supportsReasoningEffort: true },
    });
    const result = inner(buildProviderOptions({ level: "high", model }));
    expect(result).toEqual({
      reasoning_effort: "high",
      thinking: { type: "enabled" },
    });
  });
});

// ─── level "off" handling ─────────────────────────────────────────────────

describe("buildProviderOptions — level off", () => {
  it("zai → thinking.type disabled when level is off", () => {
    const model = modelWith("zai");
    const result = inner(buildProviderOptions({ level: "off", model }));
    expect(result).toEqual({ thinking: { type: "disabled" } });
  });
});

// ─── thinkingLevelMap mapping ─────────────────────────────────────────────

describe("buildProviderOptions — thinkingLevelMap", () => {
  it("uses raw level when thinkingLevelMap entry is undefined", () => {
    const model = modelWith("openai", {
      compat: { supportsReasoningEffort: true },
      thinkingLevelMap: { medium: "MEDIUM" },
    });
    const result = inner(buildProviderOptions({ level: "high", model }));
    expect(result).toEqual({ reasoning_effort: "high" });
  });
});

// ─── output structure ─────────────────────────────────────────────────────

describe("buildProviderOptions — scoping", () => {
  it("scopes fields under model.provider", () => {
    const model = modelWith("openai", {
      provider: "custom-provider",
      compat: { supportsReasoningEffort: true },
    });
    const result = buildProviderOptions({ level: "high", model });
    expect(result).toHaveProperty("custom-provider.reasoning_effort", "high");
    expect(Object.keys(result)).toEqual(["custom-provider"]);
  });
});

// ─── buildHeaders (session-affinity) ───────────────────────────────────────

describe("buildHeaders", () => {
  it("emits session-affinity headers when sendSessionAffinityHeaders && sessionId", () => {
    const model = modelWith("openai", {
      compat: { sendSessionAffinityHeaders: true, thinkingFormat: "openai" },
    });
    const headers = buildHeaders({ model, sessionId: "sess-123" });
    expect(headers).toEqual({
      session_id: "sess-123",
      "x-client-request-id": "sess-123",
      "x-session-affinity": "sess-123",
    });
  });

  it("returns undefined when no sessionId provided", () => {
    const model = modelWith("openai", {
      compat: { sendSessionAffinityHeaders: true, thinkingFormat: "openai" },
    });
    expect(buildHeaders({ model })).toBeUndefined();
  });

  it("returns undefined when sendSessionAffinityHeaders is false", () => {
    const model = modelWith("openai", {
      compat: { sendSessionAffinityHeaders: false, thinkingFormat: "openai" },
    });
    expect(buildHeaders({ model, sessionId: "sess-123" })).toBeUndefined();
  });

  it("returns undefined when model has no compat (first-party provider)", () => {
    const model: Model = {
      api: "ai-sdk",
      baseUrl: "x",
      contextWindow: 1,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "m",
      input: ["text"],
      maxTokens: 1,
      name: "m",
      provider: "anthropic",
      reasoning: true,
    };
    expect(buildHeaders({ model, sessionId: "sess-123" })).toBeUndefined();
  });
});
