/**
 * Logger configuration for @sakti-code/shared/logger
 */

import type { LoggerConfig } from "./types";

/**
 * Get default logger configuration from environment variables
 */
export function getDefaultConfig(): LoggerConfig {
  const logLevel = process.env.LOG_LEVEL as LoggerConfig["level"];
  const validLevels = ["debug", "info", "warn", "error", "silent"];
  const filePath = process.env.LOG_FILE_PATH;
  const fileOutputEnv = (process.env.LOG_FILE_OUTPUT || "").toLowerCase();
  const fileOutputFromEnv = ["1", "true", "yes", "on"].includes(fileOutputEnv);

  return {
    level: validLevels.includes(logLevel || "") ? logLevel! : "info",
    prettyPrint: process.env.NODE_ENV !== "production",
    // Production always writes to file. Development can opt in via LOG_FILE_PATH/LOG_FILE_OUTPUT.
    fileOutput: process.env.NODE_ENV === "production" || fileOutputFromEnv || Boolean(filePath),
    filePath,
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
