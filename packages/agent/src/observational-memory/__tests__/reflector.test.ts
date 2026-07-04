import type { CompleteResult, Model, Usage } from "@sakti-code/llm";
import { complete } from "@sakti-code/llm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ObservationalMemoryDeps } from "../config.ts";
import type { ObservationalMemoryStorage } from "../../observational-memory-storage.ts";
import type { SessionStorageShape } from "../../session/storage.ts";
import { TokenCounter } from "../token-counter.ts";
import { ReflectionError, runReflector } from "../reflector.ts";

vi.mock("@sakti-code/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sakti-code/llm")>();
  return { ...actual, complete: vi.fn() };
});

function mockUsage(): Usage {
  return {
    input: 0,
    output: 0,
    totalTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function fauxModel(): Model {
  return {
    id: "faux",
    name: "faux",
    api: "ai-sdk",
    provider: "faux",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function textResult(text: string): CompleteResult {
  return { content: [{ type: "text", text }], finishReason: "stop", usage: mockUsage() };
}

function errorResult(message: string): CompleteResult {
  return { content: [], errorMessage: message, finishReason: "error", usage: mockUsage() };
}

const noopStorage = {} as unknown as ObservationalMemoryStorage;
const noopSessionStorage = {} as unknown as SessionStorageShape;

function createDeps(thresholds: {
  observation: number;
  reflection: number;
}): ObservationalMemoryDeps {
  return {
    storage: noopStorage,
    sessionId: "sess-1",
    projectId: "proj-1",
    scope: "thread",
    observeModel: fauxModel(),
    observeApiKey: "k",
    reflectModel: fauxModel(),
    reflectApiKey: "k",
    thresholds,
    tokenCounter: new TokenCounter(),
    sessionStorage: noopSessionStorage,
  };
}

describe("runReflector", () => {
  afterEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("returns at compression level 0 when the reflection fits the threshold", async () => {
    vi.mocked(complete).mockImplementation(async () =>
      textResult("<observations>\n* short reflection line\n</observations>"),
    );
    const result = await runReflector({
      observations: "* long original observations\n".repeat(20),
      deps: createDeps({ observation: 100, reflection: 10_000 }),
    });
    expect(result.compressionLevel).toBe(0);
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(1);
    expect(result.reflection).toContain("short reflection line");
  });

  it("escalates compression until the level cap when output never fits", async () => {
    // Reflection is always large relative to the tiny reflection threshold,
    // so validateCompression stays false and the loop walks to MAX (level 4).
    vi.mocked(complete).mockImplementation(async () =>
      textResult(`<observations>\n${"* big observation line\n".repeat(40)}</observations>`),
    );
    const result = await runReflector({
      observations: "* original\n".repeat(20),
      deps: createDeps({ observation: 100, reflection: 5 }),
    });
    expect(result.compressionLevel).toBe(4);
    // Levels 0..4 = 5 LLM calls.
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(5);
  });

  it("stops escalating once a response fits the threshold", async () => {
    let call = 0;
    vi.mocked(complete).mockImplementation(async () => {
      call++;
      // First two calls too big, third fits.
      if (call <= 2) {
        return textResult(`<observations>\n${"* big\n".repeat(40)}</observations>`);
      }
      return textResult("<observations>\n* tiny\n</observations>");
    });
    const result = await runReflector({
      observations: "* original\n".repeat(20),
      deps: createDeps({ observation: 100, reflection: 5 }),
    });
    expect(result.compressionLevel).toBe(2);
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(3);
  });

  it("throws ReflectionError on finishReason 'error'", async () => {
    vi.mocked(complete).mockImplementation(async () => errorResult("reflect provider down"));
    await expect(
      runReflector({
        observations: "* original\n",
        deps: createDeps({ observation: 100, reflection: 10_000 }),
      }),
    ).rejects.toBeInstanceOf(ReflectionError);
  });
});
