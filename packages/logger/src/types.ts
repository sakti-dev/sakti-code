/**
 * Logger type definitions for @ekacode/logger
 */

export enum LogLevels {
  DEBUG = 30,
  INFO = 40,
  WARN = 50,
  ERROR = 60,
  SILENT = Infinity,
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LoggerContext {
  package: string; // 'ekacode', 'server', 'desktop'
  module?: string; // 'tool:read', 'api:permissions', 'ipc:bridge'
  sessionId?: string; // Request/session ID for tracing
  agent?: string; // Agent name when applicable
  tool?: string; // Tool name when applicable
  requestId?: string; // Request ID for API calls
  [key: string]: unknown;
}

export interface LoggerConfig {
  level: LogLevel;
  prettyPrint: boolean;
  fileOutput: boolean;
  filePath?: string;
  redact?: string[];
}

export interface Logger {
  debug(msg: string, context?: Partial<LoggerContext>): void;
  info(msg: string, context?: Partial<LoggerContext>): void;
  warn(msg: string, context?: Partial<LoggerContext>): void;
  error(msg: string, err?: Error, context?: Partial<LoggerContext>): void;
  child(context: Partial<LoggerContext>): Logger;
}

export interface LoggerMetadata {
  timestamp: string;
  level: LogLevel;
  prefix: string;
  package: string;
  module?: string;
  sessionId?: string;
}
