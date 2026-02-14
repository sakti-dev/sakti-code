export type ProviderErrorCode =
  | "PROVIDER_UNAUTHENTICATED"
  | "PROVIDER_UNKNOWN"
  | "PROVIDER_INVALID_REQUEST"
  | "PROVIDER_ERROR";

export interface ProviderErrorPayload {
  error: {
    code: ProviderErrorCode;
    message: string;
  };
  status: 400 | 401 | 404 | 429 | 500;
}

export function normalizeProviderError(error: unknown): ProviderErrorPayload {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("not authenticated") || lower.includes("unauthorized")) {
    return {
      status: 401,
      error: {
        code: "PROVIDER_UNAUTHENTICATED",
        message,
      },
    };
  }

  if (lower.includes("provider not found")) {
    return {
      status: 404,
      error: {
        code: "PROVIDER_UNKNOWN",
        message,
      },
    };
  }

  if (lower.includes("oauth authorization not found")) {
    return {
      status: 404,
      error: {
        code: "PROVIDER_UNKNOWN",
        message,
      },
    };
  }

  if (lower.includes("unknown provider")) {
    return {
      status: 400,
      error: {
        code: "PROVIDER_UNKNOWN",
        message,
      },
    };
  }

  if (lower.includes("invalid") || lower.includes("payload")) {
    return {
      status: 400,
      error: {
        code: "PROVIDER_INVALID_REQUEST",
        message,
      },
    };
  }

  if (
    lower.includes("invalid_grant") ||
    lower.includes("authorization_pending") ||
    lower.includes("slow_down") ||
    lower.includes("expired_token")
  ) {
    return {
      status: 400,
      error: {
        code: "PROVIDER_INVALID_REQUEST",
        message,
      },
    };
  }

  if (lower.includes("rate_limit") || lower.includes("too many requests")) {
    return {
      status: 429,
      error: {
        code: "PROVIDER_ERROR",
        message,
      },
    };
  }

  return {
    status: 500,
    error: {
      code: "PROVIDER_ERROR",
      message,
    },
  };
}
