import type { LogContext } from "./types.ts";

/**
 * Decide which single DOMAIN tag a log line belongs to.
 *
 * Precedence:
 * 1. An explicit `context.domain` always wins.
 * 2. Otherwise infer from the `module`/`scope` substrings (e.g.
 *    `{ module: "ws-client" }` → `"WS"`, `{ module: "auth" }` → `"AUTH"`).
 * 3. Fall back to `"UI"` when nothing matches.
 *
 * Returns a plain `string` (not a closed union) so callers can introduce new
 * domain tags without editing this function.
 */
export function inferDomain(context: LogContext): string {
  if (context.domain !== undefined) {
    return context.domain;
  }

  const module = String(context.module ?? "ui").toLowerCase();
  const scope = context.scope == null ? "" : String(context.scope).toLowerCase();
  const candidates = `${module}:${scope}`;

  if (candidates.includes("auth")) {
    return "AUTH";
  }
  if (candidates.includes("db")) {
    return "DB";
  }
  if (candidates.includes("server")) {
    return "SERVER";
  }
  if (candidates.includes("session")) {
    return "SESSION";
  }
  if (candidates.includes("tool")) {
    return "TOOL";
  }
  if (candidates.includes("ws") || candidates.includes("websocket")) {
    return "WS";
  }
  if (candidates.includes("chat")) {
    return "CHAT";
  }
  return "UI";
}
