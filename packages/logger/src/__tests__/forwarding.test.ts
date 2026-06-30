import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createForwardingLogger } from "../forwarding.ts";
import type { LogEntry } from "../types.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createForwardingLogger", () => {
  it("calls transport with level/message and sanitized context", () => {
    const got: LogEntry[] = [];
    const log = createForwardingLogger((e) => {
      got.push(e);
    });
    log.info("hi", { domain: "UI", n: 2 });
    expect(got[0]).toEqual({
      level: "info",
      message: "hi",
      context: { domain: "UI", n: 2 },
    });
  });

  it("folds error via describeError into context.error", () => {
    const got: LogEntry[] = [];
    const log = createForwardingLogger((e) => {
      got.push(e);
    });
    log.error("boom", new Error("x"));
    expect((got[0]!.context as { error: string }).error).toBe("x");
  });

  it("drops circular refs from context without throwing", () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    const log = createForwardingLogger(() => {});
    expect(() => log.info("m", { o })).not.toThrow();
  });

  it("still prints to console when transport throws", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = createForwardingLogger(() => {
      throw new Error("ipc down");
    });
    expect(() => log.info("m")).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it("child() merges context", () => {
    const got: LogEntry[] = [];
    const log = createForwardingLogger((e) => {
      got.push(e);
    }).child({ domain: "WS" });
    log.warn("w");
    expect(got[0]?.context?.domain).toBe("WS");
  });

  it("omits context when nothing was logged", () => {
    const got: LogEntry[] = [];
    const log = createForwardingLogger((e) => {
      got.push(e);
    });
    log.info("bare");
    expect(got[0]).toEqual({ level: "info", message: "bare" });
  });

  it("sanitized context is structured-cloneable (no circular refs reach transport)", () => {
    const got: LogEntry[] = [];
    const log = createForwardingLogger((e) => {
      got.push(e);
    });
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    log.info("m", { o });
    // structuredClone would throw on a circular value; assert it does not
    expect(() => structuredClone(got[0])).not.toThrow();
  });
});
