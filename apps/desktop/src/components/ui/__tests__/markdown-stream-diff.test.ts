import { computeStreamDelta } from "@/components/ui/markdown-stream-diff";
import { describe, expect, it } from "vitest";

describe("markdown-stream-diff", () => {
  it("returns append delta when next extends prev", () => {
    expect(computeStreamDelta("hello", "hello world")).toEqual({
      type: "append",
      chunk: " world",
    });
  });

  it("returns reset when next does not extend prev", () => {
    expect(computeStreamDelta("hello world", "hello")).toEqual({
      type: "reset",
      snapshot: "hello",
    });
  });

  it("returns append with empty chunk when unchanged", () => {
    expect(computeStreamDelta("abc", "abc")).toEqual({
      type: "append",
      chunk: "",
    });
  });

  it("handles empty previous snapshot", () => {
    expect(computeStreamDelta("", "abc")).toEqual({
      type: "append",
      chunk: "abc",
    });
  });
});
