import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderRuntimeForTests, resolveChatSelection } from "../../src/provider/runtime";

describe("chat provider selection", () => {
  let testHome = "";

  beforeEach(async () => {
    testHome = await mkdtemp(join(tmpdir(), "ekacode-chat-provider-selection-"));
    process.env.EKACODE_HOME = testHome;
    delete process.env.ZAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    vi.resetModules();
    resetProviderRuntimeForTests();
  });

  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true });
  });

  it("resolves defaults when provider/model not provided", () => {
    const selection = resolveChatSelection({});

    expect(selection.providerId).toBe("zai");
    expect(selection.modelId).toBe("zai/glm-4.7");
    expect(selection.explicit).toBe(false);
  });

  it("keeps explicit provider/model selection", () => {
    const selection = resolveChatSelection({ providerId: "zai", modelId: "zai/glm-4.6v" });

    expect(selection.providerId).toBe("zai");
    expect(selection.modelId).toBe("zai/glm-4.6v");
    expect(selection.explicit).toBe(true);
  });

  it("returns 401 when explicit provider is unauthenticated", async () => {
    const providerRuntime = await import("../../src/provider/runtime");
    vi.spyOn(providerRuntime, "hasProviderEnvironmentCredential").mockReturnValue(false);
    const chatRouter = (await import("../../src/routes/chat")).default;

    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "hello",
        providerId: "zai",
        modelId: "zai/glm-4.7",
        stream: false,
      }),
    });

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.error?.code).toBe("PROVIDER_UNAUTHENTICATED");
    expect(String(payload.error?.message)).toContain("not authenticated");
  }, 15000);

  it("accepts explicit provider when persisted oauth credential exists after runtime reset", async () => {
    const { getProviderRuntime, resetProviderRuntimeForTests } =
      await import("../../src/provider/runtime");
    const runtimeA = getProviderRuntime();
    await runtimeA.authService.setOAuth({
      providerId: "zai",
      accessToken: "persisted-access",
      refreshToken: "persisted-refresh",
      expiresAt: Date.now() + 60_000,
      accountLabel: "persisted-user",
    });

    resetProviderRuntimeForTests();

    const providerRuntime = await import("../../src/provider/runtime");
    vi.spyOn(providerRuntime, "hasProviderEnvironmentCredential").mockReturnValue(false);
    const chatRouter = (await import("../../src/routes/chat")).default;

    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "hello",
        providerId: "zai",
        modelId: "zai/glm-4.7",
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.message).toContain("Streaming is required");
  }, 15000);
});
