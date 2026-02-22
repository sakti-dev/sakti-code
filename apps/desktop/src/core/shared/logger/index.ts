/**
 * Frontend logger for desktop (SolidJS renderer)
 *
 * ## Quick Start
 * ```ts
 * import { createLogger } from '@/lib/logger';
 *
 * const logger = createLogger("desktop:chat");
 * logger.info("Message received", { agent: "hybrid", tool: "read" });
 * ```
 *
 * ## Environment-Aware Log Levels
 *
 * The logger automatically detects the environment and sets appropriate log levels:
 *
 * - **Development** (`pnpm dev`): `debug` level - see all logs
 * - **Production** (`pnpm build`): `warn` level - only warnings and errors
 *
 * Override with `VITE_LOG_LEVEL` environment variable:
 * ```bash
 * VITE_LOG_LEVEL=debug pnpm dev
 * VITE_LOG_LEVEL=silent pnpm build
 * ```
 *
 * ## Naming Convention
 *
 * Use descriptive names with colons to separate package/module:
 *
 * ```ts
 * createLogger("desktop:chat")      // Good: clear hierarchy
 * createLogger("desktop:api")       // Good: clear hierarchy
 * createLogger("desktop:ipc")       // Good: clear hierarchy
 * createLogger("logger")            // Bad: not descriptive
 * ```
 *
 * ## Log Level Guidelines
 *
 * | Level  | When to Use                          | Example                           |
 * |--------|--------------------------------------|-----------------------------------|
 * | debug  | Detailed diagnostics during dev      | "State updated", "API called"     |
 * | info   | Important events for monitoring      | "User logged in", "File saved"    |
 * | warn   | Unexpected but recoverable issues    | "API slow", "Deprecated feature"  |
 * | error  | Errors affecting functionality       | "API failed", "Invalid input"     |
 *
 * **Production**: debug/info logs are hidden, only warn/error shown.
 *
 * ## Usage Examples
 *
 * ### Basic Logging
 * ```ts
 * import { createLogger } from '@/lib/logger';
 *
 * const logger = createLogger("desktop:chat");
 *
 * logger.debug("Component rendered");           // Dev only
 * logger.info("Connected to server");           // Dev only
 * logger.warn("High memory usage");             // Always visible
 * logger.error("Connection failed", err);       // Always visible
 * ```
 *
 * ### With Context
 * ```ts
 * logger.info("Message received", {
 *   agent: "hybrid",
 *   tool: "read",
 *   sessionId: "abc-123",
 * });
 * ```
 *
 * ### Error Logging
 * ```ts
 * try {
 *   await fetchData();
 * } catch (err) {
 *   logger.error("Failed to fetch data", err as Error, {
 *     endpoint: "/api/users",
 *     requestId: "req-456",
 *   });
 * }
 * ```
 *
 * ### In SolidJS Components
 * ```ts
 * import { onMount } from 'solid-js';
 * import { createLogger } from '@/lib/logger';
 *
 * const logger = createLogger("desktop:ChatComponent");
 *
 * export function ChatComponent() {
 *   onMount(() => {
 *     logger.info("Chat component mounted");
 *   });
 *
 *   const handleMessage = (msg: string) => {
 *     logger.debug("Received message", { messageLength: msg.length });
 *   };
 *
 *   return <div onMessage={handleMessage}>...</div>;
 * }
 * ```
 *
 * ## Best Practices
 *
 * ### DO ✅
 * - Use descriptive names like "desktop:chat", "desktop:api"
 * - Include relevant context (userId, requestId, agent, tool)
 * - Log errors with Error objects for stack traces
 * - Use debug for detailed diagnostics during development
 * - Use warn for issues that don't break functionality
 *
 * ### DON'T ❌
 * - Don't log sensitive data (passwords, tokens, API keys)
 * - Don't log large objects (truncate if needed)
 * - Don't over-log in production (debug/info are hidden anyway)
 * - Don't create duplicate loggers for the same module
 * - Don't use generic names like "logger" or "log"
 *
 * ## Environment Variables
 *
 * - `VITE_LOG_LEVEL` - Override default log level
 *   - Values: `debug`, `info`, `warn`, `error`, `silent`
 *   - Default: `debug` in dev, `warn` in prod
 *
 * ## Output Format
 *
 * Console logs are formatted with colors and timestamps:
 * ```
 * HH:MM:SS [desktop:chat] Message received agent=hybrid tool=read
 * ```
 *
 * - Timestamp: Current time in HH:MM:SS format
 * - Prefix: [package:module] in bold
 * - Message: The log message
 * - Context: Additional key=value pairs
 */

export type { LogLevel, Logger, LoggerConfig, LoggerContext } from "@sakti-code/shared/logger";
export { createConsoleLogger as createLogger, getDefaultLogLevel } from "./console-logger";
