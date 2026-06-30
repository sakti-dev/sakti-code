import { describe, expect, it } from "vite-plus/test";
import { resolveLogLevel } from "../loggers.ts";

describe("resolveLogLevel", () => {
  it("defaults to info when neither option nor env is set", () => {
    expect(resolveLogLevel(undefined, undefined)).toBe("info");
  });

  it("an explicit option wins over the env var", () => {
    expect(resolveLogLevel("warn", "debug")).toBe("warn");
  });

  it("falls back to the SAKTI_LOG_LEVEL env var when no option is given", () => {
    expect(resolveLogLevel(undefined, "debug")).toBe("debug");
  });

  it("accepts every valid level", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(resolveLogLevel(level, undefined)).toBe(level);
    }
  });

  it("an unrecognized env value falls back to info rather than producing a silent logger", () => {
    expect(resolveLogLevel(undefined, "trace")).toBe("info");
    expect(resolveLogLevel(undefined, "verbose")).toBe("info");
    expect(resolveLogLevel(undefined, "")).toBe("info");
  });

  it("an unrecognized option falls back to info too", () => {
    expect(resolveLogLevel("bogus" as never, "debug")).toBe("info");
  });
});
