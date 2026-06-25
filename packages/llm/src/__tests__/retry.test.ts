import { describe, expect, it } from "vitest";
import { isRetryableAssistantError } from "../retry.ts";
import type { AssistantMessage, StopReason } from "../types.ts";

/**
 * Build a minimal assistant message for retry-classification tests.
 * `errorMessage` is omitted entirely when not provided (respects
 * `exactOptionalPropertyTypes` — never set an optional field to `undefined`).
 */
function buildMsg(
  stopReason: StopReason,
  errorMessage?: string
): AssistantMessage {
  return {
    api: "ai-sdk",
    content: [{ type: "text", text: "" }],
    // Only attach errorMessage when there's actually one — keeps the object
    // shape honest under exactOptionalPropertyTypes.
    ...(errorMessage === undefined ? {} : { errorMessage }),
    model: "test-model",
    provider: "test",
    role: "assistant",
    stopReason,
    timestamp: Date.now(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

describe("isRetryableAssistantError", () => {
  describe("returns false for non-error messages", () => {
    it("returns false when stopReason is not 'error'", () => {
      expect(isRetryableAssistantError(buildMsg("stop"))).toBe(false);
    });

    it("returns false when stopReason is 'error' but errorMessage is missing", () => {
      expect(isRetryableAssistantError(buildMsg("error"))).toBe(false);
    });
  });

  describe("returns true for transient errors", () => {
    const transientErrors = [
      "Error 429: Rate limited",
      // OpenAI 500 messages ship with a status code in the wrapped error;
      // the bare prose ("server had an error") isn't matched, but the "500"
      // status that accompanies it is. Test the status-bearing form.
      "500: The server had an error while processing your request",
      "Service temporarily unavailable (503)",
      "Bad gateway (502)",
      "Gateway timeout (504)",
      "Anthropic is overloaded",
      "Connection refused",
      "fetch failed: ECONNREFUSED",
      "socket hang up",
      "Request timed out after 30000ms",
      "stream ended before message_stop",
      "WebSocket closed unexpectedly",
      "provider returned error",
      "you can retry your request after a brief wait",
    ];

    for (const errorText of transientErrors) {
      it(`retries: "${errorText.slice(0, 40)}"`, () => {
        expect(isRetryableAssistantError(buildMsg("error", errorText))).toBe(
          true
        );
      });
    }
  });

  describe("returns false for non-retryable limit/billing errors", () => {
    const permanentErrors = [
      "insufficient_quota: You exceeded your current quota",
      "FreeUsageLimitError: monthly limit reached",
      "GoUsageLimitError: weekly limit reached",
      "billing: Your plan has been deactivated",
      "quota exceeded for this API key",
      "out of budget",
      "Monthly usage limit reached. Please upgrade.",
      "available balance is insufficient",
    ];

    for (const errorText of permanentErrors) {
      it(`does not retry: "${errorText.slice(0, 40)}"`, () => {
        expect(isRetryableAssistantError(buildMsg("error", errorText))).toBe(
          false
        );
      });
    }
  });

  describe("returns false for unknown errors", () => {
    it("does not retry unrecognized error messages", () => {
      expect(
        isRetryableAssistantError(
          buildMsg("error", "something unusual happened")
        )
      ).toBe(false);
    });
  });

  describe("limit patterns win over retryable patterns", () => {
    it("does not retry when a billing term appears alongside a 429", () => {
      // "billing" (non-retryable) appears with "429" (retryable) — limit wins.
      expect(
        isRetryableAssistantError(
          buildMsg("error", "429 rate limited: billing quota exceeded")
        )
      ).toBe(false);
    });
  });
});
