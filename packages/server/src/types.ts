/**
 * Shared type definitions for @sakti-code/server
 */

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/**
 * Health check response format
 */
export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  uptime: number;
  timestamp: string;
  version: string;
}

/**
 * Prompt request body format
 */
export interface PromptRequest {
  message: string;
  stream?: boolean;
  directory?: string;
}

/**
 * Validation error (400)
 */
export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR" as const;
  readonly status = 400;
  details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

/**
 * Authorization error (401)
 */
export class AuthorizationError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  readonly status = 401;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;

  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = "NotFoundError";
  }
}
