import type { CompleteResult, Model, Usage } from "@sakti-code/llm";
import { complete } from "@sakti-code/llm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ObservationalMemoryDeps } from "../config.ts";
import type { ObservationalMemoryStorage } from "../../../observational-memory-storage.ts";
import type { SessionStorageShape } from "../../../session/storage.ts";
import { TokenCounter } from "../token-counter.ts";
import { ObservationError, runObserver } from "../observer.ts";

vi.mock("@sakti-code/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sakti-code/llm")>();
  return {
    ...actual,
    complete: vi.fn(),
  };
});

function createMockUsage(): Usage {
  return {
    input: 0,
    output: 0,
    totalTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createFauxModel(): Model {
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

function completeTextResult(text: string): CompleteResult {
  return {
    content: [{ type: "text", text }],
    finishReason: "stop",
    usage: createMockUsage(),
  };
}

function completeErrorResult(message: string): CompleteResult {
  return {
    content: [],
    errorMessage: message,
    finishReason: "error",
    usage: createMockUsage(),
  };
}

function setCompleteResponse(text: string): void {
  vi.mocked(complete).mockImplementation(async () => completeTextResult(text));
}

// Minimal stubs — runObserver only touches observe*/tokenCounter/instruction.
const noopStorage = {} as unknown as ObservationalMemoryStorage;
const noopSessionStorage = {} as unknown as SessionStorageShape;

function createDeps(overrides: Partial<ObservationalMemoryDeps> = {}): ObservationalMemoryDeps {
  return {
    storage: noopStorage,
    sessionId: "sess-1",
    projectId: "proj-1",
    scope: "thread",
    observeModel: createFauxModel(),
    observeApiKey: "observe-key",
    reflectModel: createFauxModel(),
    reflectApiKey: "reflect-key",
    thresholds: { observation: 100, reflection: 200 },
    tokenCounter: new TokenCounter(),
    sessionStorage: noopSessionStorage,
    ...overrides,
  };
}

function firstUserContent(): string {
  const call = vi.mocked(complete).mock.calls[0]![0];
  return (call.messages as Array<{ content: string }>)[0]!.content;
}

describe("runObserver", () => {
  afterEach(() => {
    vi.mocked(complete).mockReset();
  });

  it("includes existing observations in the observer prompt", async () => {
    setCompleteResponse("<observations>\n* 🔴 New obs\n</observations>");
    await runObserver({
      messagesToObserve: [{ role: "user", content: "hi", timestamp: 1 }],
      existingObservations: "* 🔴 (10:00) User likes tea",
      deps: createDeps(),
    });
    expect(firstUserContent()).toContain("Previous Observations");
    expect(firstUserContent()).toContain("User likes tea");
  });

  it("omits Previous Observations block when existingObservations is empty", async () => {
    setCompleteResponse("<observations>x</observations>");
    await runObserver({
      messagesToObserve: [{ role: "user", content: "hi", timestamp: 1 }],
      existingObservations: "",
      deps: createDeps(),
    });
    expect(firstUserContent()).not.toContain("Previous Observations");
  });

  it("passes the observer system prompt and api key to complete", async () => {
    setCompleteResponse("<observations>x</observations>");
    await runObserver({
      messagesToObserve: [{ role: "user", content: "hi", timestamp: 1 }],
      existingObservations: "",
      deps: createDeps(),
    });
    const call = vi.mocked(complete).mock.calls[0]![0];
    expect(call.system).toContain("memory consciousness");
    expect(call.apiKey).toBe("observe-key");
  });

  it("returns parsed observations and token count on a stub response", async () => {
    setCompleteResponse("<observations>\n* 🔴 User likes tea\n</observations>");
    const result = await runObserver({
      messagesToObserve: [{ role: "user", content: "hi", timestamp: 1 }],
      existingObservations: "",
      deps: createDeps(),
    });
    expect(result.observations).toContain("User likes tea");
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it("throws ObservationError when finishReason is 'error'", async () => {
    vi.mocked(complete).mockImplementation(async () => completeErrorResult("provider down"));
    await expect(
      runObserver({
        messagesToObserve: [{ role: "user", content: "hi", timestamp: 1 }],
        existingObservations: "",
        deps: createDeps(),
      }),
    ).rejects.toBeInstanceOf(ObservationError);
  });
});
