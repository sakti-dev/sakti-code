/**
 * Error handler middleware
 *
 * Catches all errors in the middleware chain and returns appropriate HTTP responses.
 * Logs errors with context for debugging.
 * Never leaks sensitive data in 500 responses.
 */

import { createLogger } from "@sakti-code/shared/logger";
import type { Context, Next } from "hono";
import type { Env } from "../index";
import type { ErrorResponse, ValidationError } from "../types";

const logger = createLogger("server:error-handler");

/**
 * Check if error is a known error type with status code
 */
function isErrorWithStatus(error: unknown): error is Error & { status: number; code: string } {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

/**
 * Check if error is ValidationError
 */
function isValidationError(error: unknown): error is ValidationError {
  return isErrorWithStatus(error) && (error as { code: string }).code === "VALIDATION_ERROR";
}

/**
 * Create error response from error
 */
function createErrorResponse(error: unknown, requestId: string): ErrorResponse {
  // Handle known error types
  if (isValidationError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        details: (error as ValidationError).details,
      },
    };
  }

  if (isErrorWithStatus(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    };
  }

  // Generic error - use safe message
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId,
    },
  };
}

/**
 * Get HTTP status code from error
 */
function getStatusCode(error: unknown): number {
  if (isErrorWithStatus(error)) {
    return error.status;
  }
  return 500;
}

/**
 * Error handler middleware
 *
 * Catches all errors in the middleware chain and returns appropriate HTTP responses.
 * Logs errors with context for debugging.
 * Never leaks sensitive data in 500 responses.
 *
 * Should be last in the middleware chain.
 *
 * NOTE: This uses Hono's app.onError() for proper error handling.
 * Use this as: app.onError((err, c) => errorHandler(err, c))
 *
 * @param err - The error that was thrown
 * @param c - Hono context
 */
export function errorHandler(err: unknown, c: Context<Env>): Response {
  const requestId = c.get("requestId");
  const path = c.req.path;

  // Log error with context
  if (err instanceof Error) {
    logger.error("Request failed", err, {
      module: "error-handler",
      requestId,
      path,
      method: c.req.method,
    });
  } else {
    logger.error("Request failed", undefined, {
      module: "error-handler",
      requestId,
      path,
      method: c.req.method,
      error: String(err),
    });
  }

  // Create error response
  const errorResponse = createErrorResponse(err, requestId);
  const statusCode = getStatusCode(err);

  return c.json(errorResponse, statusCode as 400 | 401 | 404 | 500);
}

/**
 * Legacy middleware-style error handler
 *
 * @deprecated Use app.onError() with errorHandler function instead
 */
export async function errorHandlerMiddleware(_c: Context<Env>, next: Next): Promise<void> {
  await next();
}
