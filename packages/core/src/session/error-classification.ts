export type AgentErrorKind =
  | "network_socket_closed"
  | "timeout"
  | "rate_limited"
  | "auth"
  | "provider_unavailable"
  | "unknown";

export interface ClassifiedAgentError {
  kind: AgentErrorKind;
  retryable: boolean;
  rawMessage: string;
  userMessage: string;
}

function getStatusCode(error: Record<string, unknown>): number | undefined {
  const statusCode = error.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function getMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function hasSocketCloseSignal(error: Record<string, unknown>, message: string): boolean {
  const cause = error.cause;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  const codeMatches = typeof causeCode === "string" && causeCode === "UND_ERR_SOCKET";
  const messageMatches = /other side closed|socket|connection reset|econnreset/i.test(message);
  return codeMatches || messageMatches;
}

export function classifyAgentError(error: unknown): ClassifiedAgentError {
  const rawMessage = getMessage(error);
  const asObject = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const statusCode = getStatusCode(asObject);
  const retryable = asObject.isRetryable === true;

  if (hasSocketCloseSignal(asObject, rawMessage)) {
    return {
      kind: "network_socket_closed",
      retryable: true,
      rawMessage,
      userMessage:
        "Model connection dropped while streaming (socket closed). Please retry. If this keeps happening, switch provider/model or check network stability.",
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      kind: "auth",
      retryable: false,
      rawMessage,
      userMessage: "Provider authentication failed. Check API key configuration and try again.",
    };
  }

  if (statusCode === 429) {
    return {
      kind: "rate_limited",
      retryable: true,
      rawMessage,
      userMessage: "Provider rate limit reached. Please retry in a moment.",
    };
  }

  if (/timeout|timed out/i.test(rawMessage)) {
    return {
      kind: "timeout",
      retryable: true,
      rawMessage,
      userMessage: "Model request timed out. Please retry.",
    };
  }

  if (/provider unavailable|service unavailable|bad gateway|gateway timeout/i.test(rawMessage)) {
    return {
      kind: "provider_unavailable",
      retryable: true,
      rawMessage,
      userMessage: "Model provider is temporarily unavailable. Please retry shortly.",
    };
  }

  return {
    kind: "unknown",
    retryable,
    rawMessage,
    userMessage: rawMessage,
  };
}
