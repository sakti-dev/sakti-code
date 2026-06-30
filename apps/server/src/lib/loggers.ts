import { mkdirSync } from "node:fs";
import { createConsoleLogger, type Logger, type LogLevel } from "@sakti-code/logger";
import { createPinoLogger } from "@sakti-code/logger/node";
import { getLogDir } from "./config-dirs.ts";

/**
 * The severity levels pino understands, in increasing order. Used to validate
 * {@link resolveLogLevel}'s input so a typo in `SAKTI_LOG_LEVEL` can't silently
 * disable logging (an invalid value falls back to `info`).
 */
const VALID_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Resolve the effective pino level from (in priority order) an explicit option,
 * the `SAKTI_LOG_LEVEL` env var, or the `info` default.
 *
 * The default stays `info` so production never ships verbose `debug` traces
 * (the agent/llm layers log full request/response detail — including secrets
 * like the resolved API key presence — at `debug`). To capture those during a
 * debugging session, run with `SAKTI_LOG_LEVEL=debug`. An unrecognized value is
 * ignored (falls back to `info`) rather than producing a silent pino instance.
 *
 * Pure + env-injected so the resolution is unit-testable without touching disk.
 */
export function resolveLogLevel(option: LogLevel | undefined, env: string | undefined): LogLevel {
  const candidate = option ?? env;
  if (candidate === undefined) {
    return "info";
  }
  return VALID_LEVELS.includes(candidate as LogLevel) ? (candidate as LogLevel) : "info";
}

/**
 * The per-layer loggers the server owns. Each writes to its own rolling file
 * (`server.log` / `agent.log` / `tools.log` / `llm.log`) under `logDir`.
 * `agent` is threaded into the {@link AgentHarness}, `llm` into the stream()
 * call (via the harness), `server` into routes/ws-handler, `tools` into
 * the tool factories in apps/server/src/agents/tool-registry.ts.
 */
export interface ServerLoggers {
  agent: Logger;
  llm: Logger;
  server: Logger;
  tools: Logger;
}

/**
 * Resolve the log directory: explicit `SAKTI_LOG_DIR` wins, otherwise the
 * sakti state sibling (`~/.sakti/logs`). See {@link getLogDir}.
 */
export function resolveLogDir(): string {
  return getLogDir();
}

/**
 * Build the 4-logger set backed by pino + pino-roll. If the log directory
 * can't be created/written, every layer falls back to a console logger so the
 * server still boots (and still surfaces failures in the terminal).
 *
 * The level resolves via {@link resolveLogLevel}: explicit option →
 * `SAKTI_LOG_LEVEL` → `info`. Set `SAKTI_LOG_LEVEL=debug` to capture the rich
 * request/response traces the agent/llm layers emit at debug (default `info`
 * keeps production quiet and secret-free).
 */
export function createServerLoggers(options?: {
  logDir?: string;
  level?: LogLevel;
}): ServerLoggers {
  const logDir = options?.logDir ?? resolveLogDir();
  const level = resolveLogLevel(options?.level, process.env.SAKTI_LOG_LEVEL);
  // Opt-in secret logging: set SAKTI_LOG_SECRETS=true to stop pino redacting
  // apiKey/authorization so you can confirm the key resolved from auth.json
  // actually reaches the stream call. Off by default (writes secrets to disk
  // otherwise) — rotate the key after a debugging session that enables it.
  const bypassRedaction = process.env.SAKTI_LOG_SECRETS === "true";

  try {
    mkdirSync(logDir, { recursive: true });
    const make = (dest: string, layer: string): Logger =>
      createPinoLogger({
        dest,
        layer,
        level,
        logDir,
        ...(bypassRedaction ? { redactPaths: [] } : {}),
      });
    return {
      agent: make("agent.log", "agent"),
      llm: make("llm.log", "llm"),
      server: make("server.log", "server"),
      tools: make("tools.log", "tools"),
    };
  } catch {
    // Unwritable log dir — degrade to console so logging never blocks boot.
    const consoleLogger = createConsoleLogger();
    return {
      agent: consoleLogger.child({ domain: "AGENT" }),
      llm: consoleLogger.child({ domain: "LLM" }),
      server: consoleLogger.child({ domain: "SERVER" }),
      tools: consoleLogger.child({ domain: "TOOL" }),
    };
  }
}
