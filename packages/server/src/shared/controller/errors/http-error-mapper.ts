import type { ErrorResponse, ValidationError } from "../../../types.js";

export function isErrorWithStatus(
  error: unknown
): error is Error & { status: number; code: string } {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

export function isValidationError(error: unknown): error is ValidationError {
  return isErrorWithStatus(error) && (error as { code: string }).code === "VALIDATION_ERROR";
}

export function mapErrorToResponse(error: unknown, requestId: string): ErrorResponse {
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

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId,
    },
  };
}

export function getStatusCode(error: unknown): number {
  if (isErrorWithStatus(error)) {
    return error.status;
  }
  return 500;
}
