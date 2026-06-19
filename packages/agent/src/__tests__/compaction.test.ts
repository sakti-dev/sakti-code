import { describe, expect, it } from "vitest";
import { shouldCompact } from "../compaction";

describe("shouldCompact", () => {
  it("returns true when tokens exceed contextWindow - reserveTokens", () => {
    expect(shouldCompact(190_000, 200_000, 16_000)).toBe(true);
  });

  it("returns false when within budget", () => {
    expect(shouldCompact(150_000, 200_000, 16_000)).toBe(false);
  });

  it("returns true exactly at boundary", () => {
    expect(shouldCompact(184_000, 200_000, 16_000)).toBe(true);
  });

  it("returns false one token under boundary", () => {
    expect(shouldCompact(183_999, 200_000, 16_000)).toBe(false);
  });
});
