import { formatRetryCountdown, readRetrySecondsLeft } from "@/utils/retry-timing";
import { describe, expect, it, vi } from "vitest";

describe("retry-timing", () => {
  it("formats countdown values with compact minutes/seconds", () => {
    expect(formatRetryCountdown(5)).toBe("5s");
    expect(formatRetryCountdown(60)).toBe("1m");
    expect(formatRetryCountdown(96)).toBe("1m 36s");
  });

  it("reads retry seconds left with deterministic bounds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T00:00:00.000Z"));

    expect(readRetrySecondsLeft(Date.now() + 3100)).toBe(4);
    expect(readRetrySecondsLeft(Date.now() - 200)).toBe(0);
    expect(readRetrySecondsLeft(undefined)).toBeUndefined();
  });
});
