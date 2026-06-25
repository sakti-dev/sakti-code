import { describe, expect, it } from "vitest";
import { describeError } from "../describe-error.ts";

describe("describeError", () => {
  it("returns Error.message for Error instances", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("returns strings as-is", () => {
    expect(describeError("plain")).toBe("plain");
  });

  it("JSON-serializes plain objects", () => {
    expect(describeError({ a: 1 })).toBe('{"a":1}');
  });

  it("returns a non-empty string for undefined", () => {
    expect(describeError(undefined).length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for null", () => {
    expect(describeError(null).length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for numbers", () => {
    expect(describeError(42).length).toBeGreaterThan(0);
  });

  it("handles circular refs without throwing", () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(() => describeError(o)).not.toThrow();
  });

  it("includes non-circular keys in the circular object output", () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(describeError(o)).toContain('"a":1');
  });
});
