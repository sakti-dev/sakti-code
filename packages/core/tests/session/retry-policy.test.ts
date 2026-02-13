import { describe, expect, it } from "vitest";
import { canRetryStreamAttempt, retryDelayMs } from "../../src/session/processor";

describe("retry policy", () => {
  it("computes uncapped exponential backoff delays with 3s base", () => {
    const delays = Array.from({ length: 10 }, (_, index) => retryDelayMs(index + 1, {}));
    expect(delays).toEqual([
      3000, 6000, 12000, 24000, 48000, 96000, 192000, 384000, 768000, 1536000,
    ]);
  });

  it("honors retry-after-ms header override", () => {
    const delay = retryDelayMs(4, {
      responseHeaders: {
        "retry-after-ms": "4500",
      },
    });

    expect(delay).toBe(4500);
  });

  it("honors retry-after seconds header override", () => {
    const delay = retryDelayMs(4, {
      responseHeaders: {
        "retry-after": "7",
      },
    });

    expect(delay).toBe(7000);
  });

  it("retries stream attempts up to 10 retries, then stops", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(canRetryStreamAttempt(attempt, true)).toBe(true);
    }

    expect(canRetryStreamAttempt(10, true)).toBe(false);
    expect(canRetryStreamAttempt(3, false)).toBe(false);
  });
});
