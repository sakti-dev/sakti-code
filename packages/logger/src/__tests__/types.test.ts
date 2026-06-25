import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  LogContext,
  LogEntry,
  Logger,
  LogLevel,
  TelemetrySink,
} from "../types.ts";
import { noopTelemetrySink } from "../types.ts";

describe("logger types", () => {
  it("LogLevel is the four levels", () => {
    const l: LogLevel[] = ["debug", "error", "info", "warn"];
    expect(l).toHaveLength(4);
  });

  it("Logger signature is message-first, error as 2nd arg", () => {
    const noop = (): void => {};
    const l: Logger = {
      child: () => l,
      debug: noop,
      error: noop,
      info: noop,
      warn: noop,
    };
    // compile-time check: these calls type-check
    l.info("msg", { domain: "LLM" });
    l.error("msg", new Error("x"), { domain: "LLM" });
    l.warn("msg");
    l.debug("msg");
    l.child({ module: "stream" });
    expectTypeOf<Logger>().toMatchTypeOf<object>();
  });

  it("LogEntry carries level/message/context", () => {
    const e: LogEntry = {
      level: "info",
      message: "hi",
      context: { domain: "UI" },
    };
    expect(e.level).toBe("info");
  });

  it("TelemetrySink has record + optional flush", () => {
    const s: TelemetrySink = { record() {} };
    expect(typeof s.record).toBe("function");
  });

  it("noopTelemetrySink is a valid TelemetrySink with a record fn", () => {
    expect(typeof noopTelemetrySink.record).toBe("function");
  });

  it("LogContext accepts arbitrary string keys", () => {
    const c: LogContext = { domain: "LLM", attempt: 2, model: "x" };
    expect(c.attempt).toBe(2);
  });
});
