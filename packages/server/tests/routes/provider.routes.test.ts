import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome = "";

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "ekacode-provider-routes-"));
  process.env.EKACODE_HOME = testHome;
  vi.resetModules();
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
});

describe("provider routes", () => {
  it("lists providers", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const response = await providerRouter.request("http://localhost/api/providers");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.providers.some((provider: { id: string }) => provider.id === "zai")).toBe(true);
  });

  it("lists models", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const response = await providerRouter.request("http://localhost/api/providers/models");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);
  });

  it("sets and clears provider token", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const setResponse = await providerRouter.request(
      "http://localhost/api/providers/zai/auth/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "token-abc" }),
      }
    );

    expect(setResponse.status).toBe(200);

    const authConnected = await providerRouter.request("http://localhost/api/providers/auth");
    const authConnectedBody = await authConnected.json();
    expect(authConnectedBody.zai.status).toBe("connected");

    const clearResponse = await providerRouter.request(
      "http://localhost/api/providers/zai/auth/token",
      {
        method: "DELETE",
      }
    );

    expect(clearResponse.status).toBe(200);

    const authDisconnected = await providerRouter.request("http://localhost/api/providers/auth");
    const authDisconnectedBody = await authDisconnected.json();
    expect(authDisconnectedBody.zai.status).toBe("disconnected");
  });

  it("returns 404 for unknown provider token set", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const response = await providerRouter.request(
      "http://localhost/api/providers/unknown/auth/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "token-abc" }),
      }
    );

    expect(response.status).toBe(404);
  });

  it("supports oauth authorize and callback stubs", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const authorize = await providerRouter.request(
      "http://localhost/api/providers/zai/oauth/authorize",
      {
        method: "POST",
      }
    );

    expect(authorize.status).toBe(200);
    const authorizeBody = await authorize.json();
    expect(authorizeBody.providerId).toBe("zai");
    expect(typeof authorizeBody.state).toBe("string");

    const callback = await providerRouter.request(
      "http://localhost/api/providers/zai/oauth/callback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "abc" }),
      }
    );

    expect(callback.status).toBe(200);
    const callbackBody = await callback.json();
    expect(callbackBody.ok).toBe(true);
  });
});
