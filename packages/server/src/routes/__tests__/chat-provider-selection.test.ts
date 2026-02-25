import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveChatSelection } from "../../provider/runtime";

describe("chat provider selection", () => {
  let testHome = "";

  beforeEach(async () => {
    testHome = await mkdtemp(join(tmpdir(), "sakti-code-chat-provider-selection-"));
    process.env.SAKTI_CODE_HOME = testHome;
    delete process.env.ZAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    vi.resetModules();
    const { resolveAppPaths } = await import("@sakti-code/shared/paths");
    const { registerCoreBusBindings, registerCoreDbBindings } =
      await import("@sakti-code/shared/core-server-bridge");
    const paths = resolveAppPaths();
    await mkdir(paths.config, { recursive: true });
    await mkdir(paths.state, { recursive: true });
    await mkdir(paths.db, { recursive: true });
    await mkdir(paths.logs, { recursive: true });
    const dbModule = await import("../../../db/index.ts");
    registerCoreDbBindings({
      getDb: dbModule.getDb,
      closeDb: dbModule.closeDb,
      sessions: dbModule.taskSessions,
      tasks: dbModule.tasks,
      taskDependencies: dbModule.taskDependencies,
      taskMessages: dbModule.taskMessages,
      threads: dbModule.threads,
      messages: dbModule.messages,
      workingMemory: dbModule.workingMemory,
      reflections: dbModule.reflections,
      observationalMemory: dbModule.observationalMemory,
      toolSessions: dbModule.toolSessions,
    });
    const busModule = await import("../../bus/index.ts");
    registerCoreBusBindings({
      publishTaskUpdated: async (sessionId, tasks) => {
        await busModule.publish(busModule.TaskUpdated, { sessionId, tasks });
      },
    });
    const { getProviderRuntime, resetProviderRuntimeForTests } =
      await import("../../provider/runtime");
    resetProviderRuntimeForTests();
    getProviderRuntime();
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
    const chatRouter = (await import("../chat")).default;

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

    console.log("Response status:", response.status);
    const payload1 = await response.json();
    console.log("Response payload:", JSON.stringify(payload1));

    expect(response.status).toBe(401);
    expect(payload1.error?.code).toBe("PROVIDER_UNAUTHENTICATED");
    expect(String(payload1.error?.message)).toContain("not authenticated");
  }, 15000);

  it("accepts explicit provider when persisted oauth credential exists after runtime reset", async () => {
    const { getProviderRuntime, resetProviderRuntimeForTests } =
      await import("../../provider/runtime");
    const runtimeA = getProviderRuntime();
    await runtimeA.authService.setOAuth({
      providerId: "zai",
      accessToken: "persisted-access",
      refreshToken: "persisted-refresh",
      expiresAt: Date.now() + 60_000,
      accountLabel: "persisted-user",
    });

    resetProviderRuntimeForTests();

    const chatRouter = (await import("../chat")).default;

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

  it("returns actionable error when image prompt uses text-only model without hybrid fallback", async () => {
    const { getProviderRuntime } = await import("../../provider/runtime");
    const runtime = getProviderRuntime();
    await runtime.authService.setToken({
      providerId: "zai",
      token: "test-token",
    });

    const chatRouter = (await import("../chat")).default;

    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          content: [
            { type: "text", text: "analyze this image" },
            { type: "image", image: { url: "https://example.com/image.png" } },
          ],
        },
        providerId: "zai",
        modelId: "zai/glm-5",
        stream: false,
      }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(String(payload.error)).toContain("Configure Hybrid Vision Fallback");
  }, 15000);

  it("uses model provider auth when providerId is omitted but modelId is fully qualified", async () => {
    const { getProviderRuntime } = await import("../../provider/runtime");
    const runtime = getProviderRuntime();
    await runtime.authService.setToken({
      providerId: "opencode",
      token: "opencode-token",
    });

    const chatRouter = (await import("../chat")).default;
    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "hello",
        modelId: "opencode/glm-5",
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.message).toContain("Streaming is required");
  }, 15000);

  it("uses model provider auth when providerId is stale and mismatched", async () => {
    const { getProviderRuntime } = await import("../../provider/runtime");
    const runtime = getProviderRuntime();
    await runtime.authService.setToken({
      providerId: "opencode",
      token: "opencode-token",
    });

    const chatRouter = (await import("../chat")).default;
    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "hello",
        providerId: "zai",
        modelId: "opencode/glm-5",
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.message).toContain("Streaming is required");
  }, 15000);

  it("accepts explicit openai selection when only explicit token is configured", async () => {
    const { getProviderRuntime } = await import("../../provider/runtime");
    const runtime = getProviderRuntime();
    await runtime.authService.setToken({
      providerId: "openai",
      token: "test-token",
    });

    const chatRouter = (await import("../chat")).default;

    const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "hello",
        providerId: "openai",
        modelId: "openai/gpt-4o-mini",
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.message).toContain("Streaming is required");
  }, 15000);
});
