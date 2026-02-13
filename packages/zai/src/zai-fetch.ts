import type { FetchFunction } from "@ai-sdk/provider-utils";

export interface ZaiTransportSettings {
  requestTimeoutMs?: number;
  maxSocketRetries?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

function withTimeoutSignal(
  signal: AbortSignal | null | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal: signal ?? new AbortController().signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSocketClosedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  const message = typeof e.message === "string" ? e.message : "";
  const cause = e.cause;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;

  return (
    causeCode === "UND_ERR_SOCKET" ||
    /other side closed|socket|connection reset|econnreset/i.test(message)
  );
}

/**
 * Creates a resilient fetch function for long-lived streaming responses.
 */
export function createResilientZaiFetch(
  settings: ZaiTransportSettings = {},
  baseFetch: typeof fetch = globalThis.fetch
): FetchFunction {
  return async (input, init = {}) => {
    const maxSocketRetries = Math.max(0, settings.maxSocketRetries ?? 1);
    const retryDelayMs = Math.max(0, settings.retryDelayMs ?? 200);

    for (let attempt = 0; attempt <= maxSocketRetries; attempt++) {
      const { signal, cleanup } = withTimeoutSignal(
        init.signal,
        settings.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
      );
      try {
        return await baseFetch(input, {
          ...init,
          keepalive: init.keepalive ?? true,
          signal,
        });
      } catch (error) {
        const canRetry = isSocketClosedError(error) && attempt < maxSocketRetries;
        if (!canRetry) throw error;
        if (retryDelayMs > 0) await sleep(retryDelayMs);
      } finally {
        cleanup();
      }
    }

    throw new Error("Resilient fetch exhausted retries");
  };
}
