import { describe, expect, expectTypeOf, it } from "vitest";
import { noopLogger } from "../noop.ts";
import type { Logger } from "../types.ts";

describe("noopLogger", () => {
  it("satisfies the Logger contract", () => {
    expectTypeOf(noopLogger).toMatchTypeOf<Logger>();
  });

  it("calling any method returns undefined and does not throw", () => {
    expect(() => {
      noopLogger.debug("msg", { domain: "X" });
      noopLogger.error("msg", new Error("x"), { domain: "X" });
      noopLogger.info("msg");
      noopLogger.warn("msg");
    }).not.toThrow();
    expect(noopLogger.info("msg")).toBeUndefined();
    expect(noopLogger.error("msg", new Error("e"))).toBeUndefined();
  });

  it("child() returns a Logger (and its methods are also no-ops)", () => {
    const child = noopLogger.child({ domain: "CHILD" });
    expectTypeOf(child).toMatchTypeOf<Logger>();
    expect(() => child.info("nested")).not.toThrow();
    expect(child.child({ module: "m" }).warn("x")).toBeUndefined();
  });
});
