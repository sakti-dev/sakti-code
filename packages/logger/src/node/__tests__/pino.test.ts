import { describe, expect, it } from "vite-plus/test";
import {
  createPinoLogger,
  type PinoFactory,
  type PinoLike,
  type PinoOptions,
} from "../../node/pino.ts";
import type { LogEntry, TelemetrySink } from "../../types.ts";

/** Build a recording fake pino. Returns the instance + the call log + captured factory opts. */
function recordingPino(): {
  factory: PinoFactory;
  calls: Array<{ level: string; obj: unknown; msg: string }>;
  opts: () => PinoOptions | undefined;
} {
  const calls: Array<{ level: string; obj: unknown; msg: string }> = [];
  let captured: PinoOptions | undefined;
  const makeInstance = (): PinoLike => ({
    debug: (o, m) => calls.push({ level: "debug", obj: o, msg: m }),
    error: (o, m) => calls.push({ level: "error", obj: o, msg: m }),
    info: (o, m) => calls.push({ level: "info", obj: o, msg: m }),
    warn: (o, m) => calls.push({ level: "warn", obj: o, msg: m }),
  });
  const factory: PinoFactory = (opts) => {
    captured = opts;
    return makeInstance();
  };
  return { factory, calls, opts: () => captured };
}

describe("createPinoLogger", () => {
  it("logs via the adapter, tagging every record with layer", () => {
    const { factory, calls } = recordingPino();
    const log = createPinoLogger({
      dest: "agent.log",
      layer: "agent",
      logDir: "/tmp/x",
      pinoFactory: factory,
    });
    log.info("hi", { domain: "AGENT" });
    expect(calls[0]).toEqual({
      level: "info",
      obj: { domain: "AGENT", layer: "agent" },
      msg: "hi",
    });
  });

  it("folds a logged error into obj.error via describeError", () => {
    const { factory, calls } = recordingPino();
    const log = createPinoLogger({
      dest: "llm.log",
      layer: "llm",
      logDir: "/tmp/x",
      pinoFactory: factory,
    });
    log.error("boom", new Error("upstream down"), { domain: "LLM" });
    expect((calls[0]?.obj as { error: string }).error).toBe("upstream down");
    expect((calls[0]?.obj as { layer: string }).layer).toBe("llm");
  });

  it("child() preserves layer and merges context", () => {
    const { factory, calls } = recordingPino();
    const log = createPinoLogger({
      dest: "agent.log",
      layer: "agent",
      logDir: "/tmp/x",
      pinoFactory: factory,
    }).child({ module: "loop" });
    log.info("turn start");
    expect(calls[0]?.obj).toEqual({ module: "loop", layer: "agent" });
  });

  it("telemetry sink receives each entry (no-op default does nothing)", () => {
    const { factory } = recordingPino();
    const seen: LogEntry[] = [];
    const telemetry: TelemetrySink = { record: (e) => seen.push(e) };
    const log = createPinoLogger({
      dest: "x.log",
      layer: "x",
      logDir: "/tmp/x",
      telemetry,
      pinoFactory: factory,
    });
    log.warn("w", { attempt: 1 });
    expect(seen[0]).toMatchObject({ level: "warn", message: "w" });
  });

  it("default redact paths include apiKey/authorization/cookie", () => {
    const { factory, opts } = recordingPino();
    createPinoLogger({
      dest: "x.log",
      layer: "x",
      logDir: "/tmp/x",
      pinoFactory: factory,
    });
    const paths = opts()?.redact.paths;
    expect(paths).toContain("*.apiKey");
    expect(paths).toContain("*.authorization");
    expect(paths).toContain("*.cookie");
  });

  it("custom redactPaths override the defaults", () => {
    const { factory, opts } = recordingPino();
    createPinoLogger({
      dest: "x.log",
      layer: "x",
      logDir: "/tmp/x",
      redactPaths: ["secret"],
      pinoFactory: factory,
    });
    expect(opts()?.redact.paths).toEqual(["secret"]);
  });

  it("forwards the configured level to pino", () => {
    const { factory, opts } = recordingPino();
    createPinoLogger({
      dest: "x.log",
      layer: "x",
      logDir: "/tmp/x",
      level: "debug",
      pinoFactory: factory,
    });
    expect(opts()?.level).toBe("debug");
  });
});
