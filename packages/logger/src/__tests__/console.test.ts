import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createConsoleLogger,
  createDomainLogger,
  createLogger,
} from "../console.ts";

const UI_CLICKED_PREFIX_PATTERN = /^\[UI:USER_CLICKED\] User clicked/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createConsoleLogger", () => {
  it("info prints to console.info with [DOMAIN:ACTION] prefix", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    createConsoleLogger({ domain: "UI" }).info("User clicked");
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(UI_CLICKED_PREFIX_PATTERN)
    );
  });

  it("error prints to console.error and folds describeError into context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    createConsoleLogger().error("Save failed", new Error("disk full"), {
      domain: "DB",
    });
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain("Save failed");
    expect(line).toContain("disk full");
  });

  it("warn -> console.warn, debug -> console.log", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createConsoleLogger();
    log.warn("careful");
    log.debug("trace");
    expect(warnSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("child() merges context (module hint still infers WS)", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const child = createConsoleLogger({ domain: "WS" }).child({
      module: "ws-client",
    });
    child.info("connected");
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line.startsWith("[WS:")).toBe(true);
  });

  it("formats non-internal context as key=value pairs", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    createConsoleLogger().info("hi", { attempt: 2, model: "gpt" });
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain("attempt=2");
    expect(line).toContain("model=gpt");
  });

  it("createLogger and createDomainLogger produce working loggers", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    createLogger({ domain: "UI" }).info("hi");
    createDomainLogger("AUTH").info("signed in");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
