import { describe, expect, it } from "vite-plus/test";
import { formatDuration } from "../format-duration.ts";

describe("formatDuration", () => {
  it("formats sub-second as <1s", () => {
    expect(formatDuration(500)).toBe("<1s");
  });

  it("formats seconds", () => {
    expect(formatDuration(45000)).toBe("45s");
  });

  it("formats minutes with seconds", () => {
    expect(formatDuration(906000)).toBe("15m 6s");
  });

  it("formats round minutes without seconds", () => {
    expect(formatDuration(120000)).toBe("2m");
  });

  it("formats hours with minutes", () => {
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });

  it("formats hours with minutes and seconds", () => {
    expect(formatDuration(3_930_000)).toBe("1h 5m 30s");
  });
});
