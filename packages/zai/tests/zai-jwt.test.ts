import { describe, expect, it, vi } from "vitest";

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("zai jwt", () => {
  it("should return raw api key when no secret is provided", async () => {
    vi.resetModules();
    const { getZaiAuthorizationHeader } = await import("../src/zai-jwt");
    const header = await getZaiAuthorizationHeader("plain-api-key");
    expect(header).toBe("Bearer plain-api-key");
  });

  it("should generate a signed jwt when api key contains secret", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    const { getZaiAuthorizationHeader } = await import("../src/zai-jwt");
    const header = await getZaiAuthorizationHeader("testKey.testSecret");
    const token = header.replace("Bearer ", "");

    const [headerPart, payloadPart, signaturePart] = token.split(".");
    expect(signaturePart).toBeDefined();

    const decodedHeader = JSON.parse(decodeBase64Url(headerPart));
    const decodedPayload = JSON.parse(decodeBase64Url(payloadPart));

    expect(decodedHeader).toEqual({ alg: "HS256", sign_type: "SIGN" });
    expect(decodedPayload.api_key).toBe("testKey");
    expect(decodedPayload.timestamp).toBe(1735689600000);
    expect(decodedPayload.exp).toBeGreaterThan(decodedPayload.timestamp);

    const signingInput = `${headerPart}.${payloadPart}`;
    const { createHmac } = await import("node:crypto");
    const expectedSignature = base64UrlEncode(
      createHmac("sha256", "testSecret").update(signingInput).digest()
    );
    expect(signaturePart).toBe(expectedSignature);

    vi.useRealTimers();
  });

  it("should cache jwt for a short period", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    const { getZaiAuthorizationHeader } = await import("../src/zai-jwt");
    const header1 = await getZaiAuthorizationHeader("testKey.testSecret");
    const header2 = await getZaiAuthorizationHeader("testKey.testSecret");
    expect(header1).toBe(header2);

    vi.setSystemTime(new Date("2025-01-01T00:04:00.000Z"));
    const header3 = await getZaiAuthorizationHeader("testKey.testSecret");
    expect(header3).not.toBe(header1);

    vi.useRealTimers();
  });
});
