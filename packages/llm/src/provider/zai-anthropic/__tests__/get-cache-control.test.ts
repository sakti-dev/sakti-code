import { describe, expect, it } from "vite-plus/test";
import { CacheControlValidator } from "../get-cache-control.ts";

describe("CacheControlValidator", () => {
  it("allows up to 4 breakpoints and warns on the 5th", () => {
    const v = new CacheControlValidator();
    expect(v.addBreakpoint()).toEqual({ type: "ephemeral" });
    expect(v.addBreakpoint()).toEqual({ type: "ephemeral" });
    expect(v.addBreakpoint()).toEqual({ type: "ephemeral" });
    expect(v.addBreakpoint()).toEqual({ type: "ephemeral" });
    expect(v.addBreakpoint()).toBeUndefined();
    expect(v.getWarnings()).toHaveLength(1);
  });

  it("addBreakpoint respects a custom ttl", () => {
    const v = new CacheControlValidator();
    expect(v.addBreakpoint("1h")).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("getWarnings stays empty under the limit", () => {
    const v = new CacheControlValidator();
    v.addBreakpoint();
    v.addBreakpoint();
    expect(v.getWarnings()).toEqual([]);
  });
});
