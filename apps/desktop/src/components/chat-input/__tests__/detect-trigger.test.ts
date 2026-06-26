import { describe, expect, it } from "vitest";
import { detectTrigger } from "../detect-trigger.ts";

describe("detectTrigger", () => {
  it("fires for / typed at caret 0", () => {
    expect(detectTrigger("/", 1)).toEqual({ char: "/", index: 0 });
  });

  it("does NOT fire for / not at caret 0", () => {
    expect(detectTrigger("hi /", 4)).toBeNull();
  });

  it("fires for @ at any position", () => {
    expect(detectTrigger("@", 1)).toEqual({ char: "@", index: 0 });
    expect(detectTrigger("see @", 5)).toEqual({ char: "@", index: 4 });
  });

  it("returns null when the char before the caret is not a trigger", () => {
    expect(detectTrigger("abc", 3)).toBeNull();
  });

  it("returns null for empty input or caret 0", () => {
    expect(detectTrigger("", 0)).toBeNull();
    expect(detectTrigger("hello", 0)).toBeNull();
  });
});
