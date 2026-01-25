/**
 * Logger configuration for @ekacode/logger
 */

import type { LoggerConfig } from "./types";

/**
 * Get default logger configuration from environment variables
 */
export function getDefaultConfig(): LoggerConfig {
  const logLevel = process.env.LOG_LEVEL as LoggerConfig["level"];
  const validLevels = ["debug", "info", "warn", "error", "silent"];

  return {
    level: validLevels.includes(logLevel || "") ? logLevel! : "info",
    prettyPrint: process.env.NODE_ENV !== "production",
    fileOutput: process.env.NODE_ENV === "production",
    filePath: process.env.LOG_FILE_PATH,
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "apiKey",
      "token",
      "password",
      "secret",
    ],
  };
}

/**
 * Get package-specific log level override
 */
export function getPackageLogLevel(
  packageName: string
): "debug" | "info" | "warn" | "error" | "silent" {
  const envVar = `LOG_LEVEL_${packageName.toUpperCase()}`;
  const level = process.env[envVar] as LoggerConfig["level"];
  const validLevels = ["debug", "info", "warn", "error", "silent"];
  return validLevels.includes(level || "") ? level! : "info";
}
