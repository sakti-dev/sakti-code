import { describe, expect, it } from "vitest";
import { normalizeProviderError } from "../errors";

describe("normalizeProviderError", () => {
  it("maps unauthenticated provider to stable code", () => {
    const normalized = normalizeProviderError(new Error("Provider zai is not authenticated"));

    expect(normalized.status).toBe(401);
    expect(normalized.error.code).toBe("PROVIDER_UNAUTHENTICATED");
  });

  it("maps unknown provider to stable code", () => {
    const normalized = normalizeProviderError(new Error("Unknown provider: zen"));

    expect(normalized.status).toBe(400);
    expect(normalized.error.code).toBe("PROVIDER_UNKNOWN");
  });

  it("falls back to generic provider error", () => {
    const normalized = normalizeProviderError(new Error("boom"));

    expect(normalized.status).toBe(500);
    expect(normalized.error.code).toBe("PROVIDER_ERROR");
  });
});
