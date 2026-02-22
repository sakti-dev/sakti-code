import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome = "";

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "ekacode-provider-routes-"));
  process.env.EKACODE_HOME = testHome;
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
});

describe("provider routes", () => {
  it("lists provider catalog with searchable metadata", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const response = await providerRouter.request("http://localhost/api/providers/catalog");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.providers.length).toBeGreaterThan(3);

    const zai = data.providers.find((provider: { id: string }) => provider.id === "zai");
    expect(zai).toBeTruthy();
    expect(Array.isArray(zai.aliases)).toBe(true);
    expect(Array.isArray(zai.authMethods)).toBe(true);
    expect(typeof zai.connected).toBe("boolean");
    expect(typeof zai.modelCount).toBe("number");
    expect(typeof zai.popular).toBe("boolean");

    const opencode = data.providers.find((provider: { id: string }) => provider.id === "opencode");
    if (opencode) {
      expect(opencode.popular).toBe(true);
    }
  });

  it("lists providers", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const response = await providerRouter.request("http://localhost/api/providers");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.providers.some((provider: { id: string }) => provider.id === "zai")).toBe(true);
  });

  it("lists catalog-backed providers beyond built-in adapters", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const response = await providerRouter.request("http://localhost/api/providers");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.providers.some((provider: { id: string }) => provider.id === "openrouter")).toBe(
      true
    );
  });

  it("lists models", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const response = await providerRouter.request("http://localhost/api/providers/models");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);
  });

  it("stores and returns provider preferences", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const initial = await providerRouter.request("http://localhost/api/providers/preferences");
    expect(initial.status).toBe(200);
    const initialBody = await initial.json();
    expect(initialBody.selectedProviderId).toBeNull();
    expect(initialBody.selectedModelId).toBeNull();
    expect(initialBody.hybridEnabled).toBe(true);
    expect(initialBody.hybridVisionProviderId).toBeNull();
    expect(initialBody.hybridVisionModelId).toBeNull();

    const update = await providerRouter.request("http://localhost/api/providers/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
        hybridEnabled: true,
        hybridVisionProviderId: "zai",
        hybridVisionModelId: "zai/glm-4.6v",
      }),
    });
    expect(update.status).toBe(200);
    const updateBody = await update.json();
    expect(updateBody.selectedProviderId).toBe("zai");
    expect(updateBody.selectedModelId).toBe("zai/glm-4.7");
    expect(updateBody.hybridEnabled).toBe(true);
    expect(updateBody.hybridVisionProviderId).toBe("zai");
    expect(updateBody.hybridVisionModelId).toBe("zai/glm-4.6v");

    const after = await providerRouter.request("http://localhost/api/providers/preferences");
    expect(after.status).toBe(200);
    const afterBody = await after.json();
    expect(afterBody.selectedProviderId).toBe("zai");
    expect(afterBody.selectedModelId).toBe("zai/glm-4.7");
    expect(afterBody.hybridEnabled).toBe(true);
    expect(afterBody.hybridVisionProviderId).toBe("zai");
    expect(afterBody.hybridVisionModelId).toBe("zai/glm-4.6v");
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

  it("sets and clears token for non-adapter catalog providers", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;
    const providerId = "openrouter";

    const setResponse = await providerRouter.request(
      `http://localhost/api/providers/${providerId}/auth/token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "token-openrouter" }),
      }
    );

    expect(setResponse.status).toBe(200);

    const authConnected = await providerRouter.request("http://localhost/api/providers/auth");
    const authConnectedBody = await authConnected.json();
    expect(authConnectedBody[providerId].status).toBe("connected");

    const clearResponse = await providerRouter.request(
      `http://localhost/api/providers/${providerId}/auth/token`,
      {
        method: "DELETE",
      }
    );

    expect(clearResponse.status).toBe(200);

    const authDisconnected = await providerRouter.request("http://localhost/api/providers/auth");
    const authDisconnectedBody = await authDisconnected.json();
    expect(authDisconnectedBody[providerId].status).toBe("disconnected");
  });

  it("does not expose oauth methods for opencode and zai providers", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const methods = await providerRouter.request("http://localhost/api/providers/auth/methods");
    expect(methods.status).toBe(200);
    const methodsBody = await methods.json();
    expect(Array.isArray(methodsBody.opencode)).toBe(true);
    expect(Array.isArray(methodsBody.zai)).toBe(true);
    expect(Array.isArray(methodsBody.openai)).toBe(true);
    expect(methodsBody.openai.some((method: { type: string }) => method.type === "api")).toBe(true);
    expect(methodsBody.opencode.some((method: { type: string }) => method.type === "oauth")).toBe(
      false
    );
    expect(methodsBody.zai.some((method: { type: string }) => method.type === "oauth")).toBe(false);
  });

  it("returns normalized error when oauth authorize is requested for non-oauth provider", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;
    const authorize = await providerRouter.request(
      "http://localhost/api/providers/opencode/oauth/authorize",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: 0 }),
      }
    );

    expect(authorize.status).toBe(400);
    const body = await authorize.json();
    expect(body.error?.code).toBe("PROVIDER_INVALID_REQUEST");
  });

  it("returns normalized oauth error for missing authorization", async () => {
    const providerRouter = (await import("../../src/routes/provider")).default;

    const callback = await providerRouter.request(
      "http://localhost/api/providers/opencode/oauth/callback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: 1,
          authorizationId: "missing-auth",
          code: "abc",
        }),
      }
    );

    expect(callback.status).toBe(404);
    const body = await callback.json();
    expect(body.error?.code).toBe("PROVIDER_UNKNOWN");
  });
});
