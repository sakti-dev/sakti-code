import { type CompleteResult, complete, type Model, type Usage } from "@sakti-code/llm";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { generateBranchSummaryEffect } from "../branch-summarization.ts";

// Mock `complete` so we can capture the request without a real provider call.
vi.mock("@sakti-code/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sakti-code/llm")>();
  return { ...actual, complete: vi.fn() };
});

function mockUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

const model: Model = {
  id: "mock",
  name: "mock",
  api: "ai-sdk",
  provider: "openai",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 2048,
};

describe("generateBranchSummaryEffect", () => {
  afterEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("omits maxOutputTokens so the provider default applies", async () => {
    const summaryResult: CompleteResult = {
      content: [{ type: "text", text: "summary" }],
      finishReason: "stop",
      usage: mockUsage(),
    };
    vi.mocked(complete).mockImplementation(async () => summaryResult);

    const entries = [
      {
        id: "e1",
        parentId: null,
        timestamp: "0",
        type: "message" as const,
        message: { role: "user" as const, content: "hello", timestamp: 0 },
      },
    ];

    await Effect.runPromise(
      generateBranchSummaryEffect(entries, {
        apiKey: "k",
        model,
        prompts: { preamble: "p", prompt: "summarize", systemPrompt: "sys" },
        signal: new AbortController().signal,
      }),
    );

    expect(vi.mocked(complete)).toHaveBeenCalledTimes(1);
    const req = vi.mocked(complete).mock.calls[0]![0];
    // The main agent loop omits maxOutputTokens (lets the provider default
    // apply, e.g. z.ai's ?? 4096). Branch summarization must do the same —
    // never reserve model.maxTokens (the capability ceiling), which would
    // starve the input budget. See docs/plans/2026-07-12-omit-max-output-tokens.md.
    expect(req.maxOutputTokens).toBeUndefined();
  });
});
