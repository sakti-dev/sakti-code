import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { LogContext, Logger } from "@sakti-code/logger";
import { describe, expect, it } from "vitest";
import { streamWithModel } from "../stream.ts";
import type { Model } from "../types.ts";

const model: Model = {
  api: "ai-sdk",
  baseUrl: "https://example.com",
  contextWindow: 200_000,
  cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
  id: "test-model",
  input: ["text"],
  maxTokens: 8192,
  name: "Test",
  provider: "testprov",
  reasoning: true,
};

const fakeLanguage: LanguageModelV3 = {
  modelId: "test-model",
  provider: "testprov",
  specificationVersion: "v3",
} as LanguageModelV3;

/** A spy logger that records every call so tests can assert what was logged. */
function spyLogger() {
  const errors: Array<{
    message: string;
    error: unknown;
    context: LogContext | undefined;
  }> = [];
  const debugs: Array<{ message: string; context: LogContext | undefined }> =
    [];
  const rec: Logger = {
    child: () => rec,
    debug: (message, context) => debugs.push({ message, context }),
    error: (message, error, context) =>
      errors.push({ message, error, context }),
    info: () => {},
    warn: () => {},
  };
  return { logger: rec, errors, debugs };
}

/** A fake streamText result whose fullStream yields a single error part. */
function errorStreamResult(error: unknown) {
  const fail = Promise.reject(error);
  return {
    fullStream: (async function* () {
      yield { type: "error", error };
    })(),
    finishReason: fail,
    response: fail,
    usage: fail,
  };
}

describe("streamWithModel logging", () => {
  it("logs full error detail when the stream emits an error part", async () => {
    const { logger, errors } = spyLogger();
    const streamError = new Error("Upstream request failed");
    const fake = () => errorStreamResult(streamError);
    const { fullStream, result } = streamWithModel(
      { messages: [], model, logger },
      fakeLanguage,
      fake as never
    );

    // Drain the stream — the wrapper must still yield the error part through.
    const parts: unknown[] = [];
    for await (const part of fullStream) {
      parts.push(part);
    }
    await result.catch(() => {});

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("stream error");
    expect(errors[0]?.error).toBe(streamError);
    expect(errors[0]?.context).toMatchObject({
      model: "test-model",
      provider: "testprov",
      baseURL: "https://example.com",
    });
    // The error part still reaches the consumer (agent loop relies on it).
    expect(parts).toHaveLength(1);
  });

  it("does not wrap or log when no logger is supplied (zero overhead)", async () => {
    // Use a benign (resolving) stream so the unconsumed result promise can't reject.
    const okResult = {
      fullStream: (async function* () {
        yield { type: "text-delta", text: "hi" };
      })(),
      finishReason: Promise.resolve("stop" as const),
      response: Promise.resolve({ id: "r", modelId: "test-model" }),
      usage: Promise.resolve({
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
    };
    const fake = () => okResult;
    const { fullStream, result } = streamWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    // Identity preserved: nothing to instrument when there's no logger.
    expect(fullStream).toBe(okResult.fullStream);
    await result;
  });
});
