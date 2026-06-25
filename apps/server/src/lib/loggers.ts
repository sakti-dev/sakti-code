import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createConsoleLogger,
  type Logger,
  type LogLevel,
} from "@sakti-code/logger";
import { createPinoLogger } from "@sakti-code/logger/node";

/**
 * The per-layer loggers the server owns. Each writes to its own rolling file
 * (`server.log` / `agent.log` / `tools.log` / `llm.log`) under `logDir`.
 * `agent` is threaded into the {@link AgentHarness}, `llm` into the stream()
 * call (via the harness), `server` into routes/ws-handler, `tools` into
 * buildTools.
 */
export interface ServerLoggers {
  agent: Logger;
  llm: Logger;
  server: Logger;
  tools: Logger;
}

/**
 * Resolve the log directory: explicit env override wins, otherwise the shared
 * app config dir (`~/.config/sakti-code/logs`).
 */
export function resolveLogDir(): string {
  return (
    process.env.SAKTI_LOG_DIR ??
    join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
      "sakti-code",
      "logs"
    )
  );
}

/**
 * Build the 4-logger set backed by pino + pino-roll. If the log directory
 * can't be created/written, every layer falls back to a console logger so the
 * server still boots (and still surfaces failures in the terminal).
 */
export function createServerLoggers(options?: {
  logDir?: string;
  level?: LogLevel;
}): ServerLoggers {
  const logDir = options?.logDir ?? resolveLogDir();
  const level = options?.level;

  try {
    mkdirSync(logDir, { recursive: true });
    const make = (dest: string, layer: string): Logger =>
      createPinoLogger({ dest, layer, logDir, ...(level ? { level } : {}) });
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
