import { describe, expect, it, vi } from "vitest";
import { createResilientZaiFetch } from "../src/zai-fetch";

describe("createResilientZaiFetch", () => {
  it("passes an AbortSignal to downstream fetch", async () => {
    const baseFetch: typeof fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const resilientFetch = createResilientZaiFetch({ requestTimeoutMs: 5000 }, baseFetch);

    await resilientFetch("https://example.com", {});

    const init = baseFetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeDefined();
  });

  it("aborts slow request when timeout is reached", async () => {
    const baseFetch: typeof fetch = vi.fn((_: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });

    const resilientFetch = createResilientZaiFetch({ requestTimeoutMs: 20 }, baseFetch);

    await expect(resilientFetch("https://example.com", {})).rejects.toThrow("aborted");
  });

  it("retries socket-close errors and succeeds on next attempt", async () => {
    let attempts = 0;
    const baseFetch: typeof fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("other side closed");
        Object.assign(error, { cause: { code: "UND_ERR_SOCKET" } });
        throw error;
      }
      return new Response("ok", { status: 200 });
    });

    const resilientFetch = createResilientZaiFetch(
      { requestTimeoutMs: 5000, maxSocketRetries: 1, retryDelayMs: 0 },
      baseFetch
    );

    const response = await resilientFetch("https://example.com", {});
    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });
});
