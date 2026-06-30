import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import type { CompleteRequest, CompleteResult } from "../complete.ts";
import type { StreamRequest, StreamResult } from "../stream.ts";

// Mock the underlying stream/complete before importing the effect wrappers
vi.mock("../stream.ts", () => ({
  stream: vi.fn(),
}));
vi.mock("../complete.ts", () => ({
  complete: vi.fn(),
}));

import { complete as mockedComplete } from "../complete.ts";
import { completeEffect, LLMError, streamEffect } from "../effect.ts";
// Import after mocks are in place
import { stream as mockedStream } from "../stream.ts";

const fakeModel = {
  id: "test",
  name: "test",
  api: "ai-sdk" as const,
  provider: "openai",
  baseUrl: "",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 2048,
};

function makeStreamRequest(): StreamRequest {
  return { model: fakeModel, messages: [] };
}

function makeCompleteRequest(): CompleteRequest {
  return { model: fakeModel, messages: [] };
}

describe("LLMError", () => {
  it("is a Schema.TaggedErrorClass with _tag 'LLMError'", () => {
    const error = new LLMError({ message: "boom" });
    expect(error._tag).toBe("LLMError");
    expect(error.message).toBe("boom");
    expect(error).toBeInstanceOf(Error);
  });

  it("is yieldable and catchable via Effect.catchTag", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* new LLMError({ message: "yielded" });
      }).pipe(Effect.catchTag("LLMError", (e) => Effect.succeed(`caught: ${e.message}`))),
    );
    expect(result).toBe("caught: yielded");
  });
});

describe("streamEffect", () => {
  it("succeeds with StreamResult when underlying stream resolves", async () => {
    const fakeResult: StreamResult = {
      fullStream: (async function* () {})(),
      result: Promise.resolve({
        finishReason: "stop",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }),
    };
    vi.mocked(mockedStream).mockResolvedValueOnce(fakeResult);

    const result = await Effect.runPromise(streamEffect(makeStreamRequest()));
    expect(result).toBe(fakeResult);
  });

  it("fails with LLMError when underlying stream rejects", async () => {
    vi.mocked(mockedStream).mockRejectedValueOnce(new Error("network down"));

    const error = await Effect.runPromise(Effect.flip(streamEffect(makeStreamRequest())));
    expect(error._tag).toBe("LLMError");
    expect(error.message).toContain("stream failed");
  });
});

describe("completeEffect", () => {
  it("succeeds with CompleteResult when underlying complete resolves", async () => {
    const fakeResult: CompleteResult = {
      content: [{ type: "text", text: "done" }],
      finishReason: "stop",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    vi.mocked(mockedComplete).mockResolvedValueOnce(fakeResult);

    const result = await Effect.runPromise(completeEffect(makeCompleteRequest()));
    expect(result).toBe(fakeResult);
  });

  it("fails with LLMError when underlying complete rejects", async () => {
    vi.mocked(mockedComplete).mockRejectedValueOnce(new Error("provider 500"));

    const error = await Effect.runPromise(Effect.flip(completeEffect(makeCompleteRequest())));
    expect(error._tag).toBe("LLMError");
    expect(error.message).toContain("complete failed");
  });
});
