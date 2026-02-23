import { Instance } from "@/instance";
import { describe, expect, it, vi } from "vitest";

type ProviderOptions = { apiKey?: string; baseURL?: string; headers?: Record<string, string> };
type ProviderModel = { provider: string; modelId: string; options: ProviderOptions };
type ProviderFn = ((modelId: string) => ProviderModel) & {
  chat?: (modelId: string) => ProviderModel;
  responses?: (modelId: string) => ProviderModel;
  agenticChat?: (modelId: string) => ProviderModel;
};

function createProviderMock(providerName: string) {
  return vi.fn((options: ProviderOptions) => {
    const provider = vi.fn((modelId: string) => ({
      provider: providerName,
      modelId,
      options,
    })) as ProviderFn;
    return provider;
  });
}

const createOpenAIMock = vi.fn(
  (options: ProviderOptions) => {
    const provider = vi.fn((modelId: string) => ({
      provider: "openai",
      modelId,
      options,
    })) as ProviderFn;
    provider.chat = vi.fn((modelId: string) => ({
      provider: "openai-compatible",
      modelId,
      options,
    }));
    provider.responses = vi.fn((modelId: string) => ({
      provider: "openai-responses",
      modelId,
      options,
    }));
    return provider;
  }
);

const createOpenAICompatibleMock = vi.fn(
  (options: ProviderOptions) => {
    const provider = vi.fn((modelId: string) => ({
      provider: "openai-compatible-sdk",
      modelId,
      options,
    })) as ProviderFn;
    if (!options.headers?.["x-no-chat"]) {
      provider.chat = vi.fn((modelId: string) => ({
        provider: "openai-compatible-sdk-chat",
        modelId,
        options,
      }));
    }
    return provider;
  }
);

const createAnthropicMock = createProviderMock("anthropic");
const createAzureMock = vi.fn(
  (options: ProviderOptions) => {
    const provider = vi.fn((modelId: string) => ({
      provider: "azure",
      modelId,
      options,
    })) as ProviderFn;
    provider.responses = vi.fn((modelId: string) => ({
      provider: "openai-responses",
      modelId,
      options,
    }));
    return provider;
  }
);
const createGoogleMock = createProviderMock("google");
const createOpenRouterMock = createProviderMock("openrouter");
const createGitLabMock = vi.fn(
  (options: { apiKey?: string; instanceUrl?: string; headers?: Record<string, string> }) => {
    const provider = vi.fn((modelId: string) => ({
      provider: "gitlab-default",
      modelId,
      options,
    })) as ProviderFn;
    provider.agenticChat = vi.fn((modelId: string) => ({
      provider: "gitlab-agentic-chat",
      modelId,
      options,
    }));
    return provider;
  }
);

const createZaiMock = vi.fn(
  (options: { apiKey?: string; endpoint?: "general" | "coding"; baseURL?: string }) =>
    vi.fn((modelId: string) => ({
      provider: "zai",
      modelId,
      options,
    }))
);

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock,
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: createAnthropicMock,
}));

vi.mock("@ai-sdk/azure", () => ({
  createAzure: createAzureMock,
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: createGoogleMock,
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: createOpenRouterMock,
}));

vi.mock("@gitlab/gitlab-ai-provider", () => ({
  createGitLab: createGitLabMock,
}));

vi.mock("@sakti-code/zai", () => ({
  createZai: createZaiMock,
}));

describe("agent/workflow/model-provider", () => {
  it("uses request-scoped context for non-zai provider selection", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "openrouter",
          modelId: "openrouter/deepseek/chat",
          providerApiUrl: "https://openrouter.example/v1",
          apiKey: "context-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "openrouter",
      modelId: "deepseek/chat",
      options: expect.objectContaining({
        apiKey: "context-key",
        baseURL: "https://openrouter.example/v1",
        headers: {
          "HTTP-Referer": "https://opencode.ai/",
          "X-Title": "opencode",
        },
      }),
    });
  });

  it("keeps zai-coding-plan on the custom zai sdk path", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "zai-coding-plan",
          modelId: "zai-coding-plan/glm-4.7",
          apiKey: "zai-context-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "zai",
      modelId: "glm-4.7",
      options: {
        apiKey: "zai-context-key",
        endpoint: "coding",
        baseURL: undefined,
      },
    });
  });

  it("keeps zai-coding-plan on custom zai sdk even when npm metadata is openai-compatible", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "zai-coding-plan",
          modelId: "zai-coding-plan/glm-4.7",
          providerNpmPackage: "@ai-sdk/openai-compatible",
          apiKey: "zai-context-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "zai",
      modelId: "glm-4.7",
      options: {
        apiKey: "zai-context-key",
        endpoint: "coding",
        baseURL: undefined,
      },
    });
  });

  it("prefers context-scoped credentials when resolving model references", async () => {
    const { getModelByReference } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "openai",
          modelId: "openai/gpt-4o",
          providerApiUrl: "https://api.context.test/v1",
          apiKey: "context-openai-key",
        };
        return getModelByReference("openai/gpt-4o-mini");
      },
    });

    expect(model).toEqual({
      provider: "openai-responses",
      modelId: "gpt-4o-mini",
      options: expect.objectContaining({
        apiKey: "context-openai-key",
        baseURL: "https://api.context.test/v1",
        headers: {},
      }),
    });
  });

  it("isolates provider runtime selection across concurrent async contexts", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const [a, b] = await Promise.all([
      Instance.provide({
        directory: process.cwd(),
        async fn() {
          Instance.context.providerRuntime = {
            providerId: "openai",
            modelId: "openai/gpt-4o",
            providerApiUrl: "https://a.example/v1",
            apiKey: "key-a",
          };
          await sleep(5);
          return getBuildModel();
        },
      }),
      Instance.provide({
        directory: process.cwd(),
        async fn() {
          Instance.context.providerRuntime = {
            providerId: "openai",
            modelId: "openai/gpt-4o-mini",
            providerApiUrl: "https://b.example/v1",
            apiKey: "key-b",
          };
          await sleep(1);
          return getBuildModel();
        },
      }),
    ]);

    expect(a).toEqual({
      provider: "openai-responses",
      modelId: "gpt-4o",
      options: expect.objectContaining({
        apiKey: "key-a",
        baseURL: "https://a.example/v1",
        headers: {},
      }),
    });
    expect(b).toEqual({
      provider: "openai-responses",
      modelId: "gpt-4o-mini",
      options: expect.objectContaining({
        apiKey: "key-b",
        baseURL: "https://b.example/v1",
        headers: {},
      }),
    });
  });

  it("builds a hybrid model when request context includes hybrid vision runtime", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");
    const { HybridAgent } = await import("@/agent/hybrid-agent");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "openai",
          modelId: "openai/gpt-4o-mini",
          providerApiUrl: "https://openai.example/v1",
          apiKey: "text-key",
          hybridVisionEnabled: true,
          hybridVisionProviderId: "zai",
          hybridVisionModelId: "zai/glm-4.6v",
          hybridVisionApiKey: "vision-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toBeInstanceOf(HybridAgent);
  });

  it("uses openai-compatible provider for chat-completions style providers", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "opencode",
          modelId: "opencode/kimi-k2.5",
          providerApiUrl: "https://opencode.ai/zen/v1",
          providerNpmPackage: "@ai-sdk/openai-compatible",
          apiKey: "zen-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "openai-compatible-sdk-chat",
      modelId: "kimi-k2.5",
      options: expect.objectContaining({
        apiKey: "zen-key",
        baseURL: "https://opencode.ai/zen/v1",
        headers: {},
      }),
    });
  });

  it("does not force responses transport for non-openai providers using @ai-sdk/openai", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "opencode",
          modelId: "opencode/gpt-5.2",
          providerApiUrl: "https://opencode.ai/zen/v1",
          providerNpmPackage: "@ai-sdk/openai",
          apiKey: "zen-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "openai",
      modelId: "gpt-5.2",
      options: expect.objectContaining({
        apiKey: "zen-key",
        baseURL: "https://opencode.ai/zen/v1",
        headers: {},
      }),
    });
  });

  it("uses openai responses transport for the openai provider", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "openai",
          modelId: "openai/gpt-5.2",
          providerApiUrl: "https://api.openai.com/v1",
          providerNpmPackage: "@ai-sdk/openai",
          apiKey: "openai-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "openai-responses",
      modelId: "gpt-5.2",
      options: expect.objectContaining({
        apiKey: "openai-key",
        baseURL: "https://api.openai.com/v1",
        headers: {},
      }),
    });
  });

  it("uses anthropic sdk for anthropic npm package", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "opencode",
          modelId: "opencode/claude-haiku-4-5",
          providerApiUrl: "https://opencode.ai/zen/v1",
          providerNpmPackage: "@ai-sdk/anthropic",
          apiKey: "zen-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      options: expect.objectContaining({
        apiKey: "zen-key",
        baseURL: "https://opencode.ai/zen/v1",
        headers: {},
      }),
    });
  });

  it("uses google sdk for google npm package", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "opencode",
          modelId: "opencode/gemini-3-flash",
          providerApiUrl: "https://opencode.ai/zen/v1",
          providerNpmPackage: "@ai-sdk/google",
          apiKey: "zen-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "google",
      modelId: "gemini-3-flash",
      options: expect.objectContaining({
        apiKey: "zen-key",
        baseURL: "https://opencode.ai/zen/v1",
        headers: {},
      }),
    });
  });

  it("uses azure sdk for azure npm package", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "azure",
          modelId: "azure/gpt-5.1",
          providerApiUrl: "https://azure.example/openai",
          providerNpmPackage: "@ai-sdk/azure",
          apiKey: "azure-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "openai-responses",
      modelId: "gpt-5.1",
      options: expect.objectContaining({
        apiKey: "azure-key",
        baseURL: "https://azure.example/openai",
        headers: {},
      }),
    });
  });

  it("uses openrouter sdk for openrouter npm package", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "openrouter",
          modelId: "openrouter/openai/gpt-5.2",
          providerApiUrl: "https://openrouter.ai/api/v1",
          providerNpmPackage: "@openrouter/ai-sdk-provider",
          apiKey: "openrouter-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-5.2",
      options: expect.objectContaining({
        apiKey: "openrouter-key",
        baseURL: "https://openrouter.ai/api/v1",
      }),
    });
  });

  it("uses gitlab agentic chat for gitlab npm package", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "gitlab",
          modelId: "gitlab/openai/gpt-5.2",
          providerNpmPackage: "@gitlab/gitlab-ai-provider",
          apiKey: "gitlab-key",
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "gitlab-agentic-chat",
      modelId: "openai/gpt-5.2",
      options: expect.objectContaining({
        apiKey: "gitlab-key",
        instanceUrl: "https://gitlab.com",
      }),
    });
  });

  it("uses v6-compatible fallback sdk routing for remaining models.dev provider npm packages", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");
    const cases = [
      "@jerome-benoit/sap-ai-provider-v2",
      "venice-ai-sdk-provider",
      "ai-gateway-provider",
    ] as const;

    for (const npmPackage of cases) {
      const model = await Instance.provide({
        directory: process.cwd(),
        async fn() {
          Instance.context.providerRuntime = {
            providerId: "provider-under-test",
            modelId: "provider-under-test/model-x",
            providerApiUrl: "https://api.example.com/v1",
            providerNpmPackage: npmPackage,
            apiKey: "provider-key",
          };
          return getBuildModel();
        },
      });

      expect(model).toEqual({
        provider: "openai-compatible-sdk",
        modelId: "model-x",
        options: expect.objectContaining({
          apiKey: "provider-key",
          baseURL: "https://api.example.com/v1",
          headers: {},
        }),
      });
    }
  });

  it("falls back when openai-compatible sdk does not expose chat()", async () => {
    const { getBuildModel } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "opencode",
          modelId: "opencode/kimi-k2.5",
          providerApiUrl: "https://opencode.ai/zen/v1",
          providerNpmPackage: "@ai-sdk/openai-compatible",
          apiKey: "zen-key",
          headers: { "x-no-chat": "1" },
        };
        return getBuildModel();
      },
    });

    expect(model).toEqual({
      provider: "openai-compatible-sdk",
      modelId: "kimi-k2.5",
      options: expect.objectContaining({
        apiKey: "zen-key",
        baseURL: "https://opencode.ai/zen/v1",
      }),
    });
  });

  it("does not leak OPENAI_API_KEY to non-openai providers when provider credentials are missing", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "openai-secret";
    try {
      const { getBuildModel } = await import("@/agent/workflow/model-provider");

      const model = await Instance.provide({
        directory: process.cwd(),
        async fn() {
          Instance.context.providerRuntime = {
            providerId: "openrouter",
            modelId: "openrouter/deepseek/chat",
            providerApiUrl: "https://openrouter.example/v1",
            providerNpmPackage: "@openrouter/ai-sdk-provider",
          };
          return getBuildModel();
        },
      });

      expect(model).toEqual({
        provider: "openrouter",
        modelId: "deepseek/chat",
        options: expect.objectContaining({
          apiKey: "",
          baseURL: "https://openrouter.example/v1",
        }),
      });
    } finally {
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }
  });

  it("does not reuse active context metadata when model reference targets a different provider", async () => {
    const { getModelByReference } = await import("@/agent/workflow/model-provider");

    const model = await Instance.provide({
      directory: process.cwd(),
      async fn() {
        Instance.context.providerRuntime = {
          providerId: "openai",
          modelId: "openai/gpt-4o",
          providerApiUrl: "https://api.context.test/v1",
          apiKey: "context-openai-key",
        };
        return getModelByReference("anthropic/claude-haiku-4-5");
      },
    });

    expect(model).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      options: expect.objectContaining({
        apiKey: "",
      }),
    });
  });

  it("messageHasImage only flags actual image content", async () => {
    const { messageHasImage } = await import("@/agent/workflow/model-provider");

    expect(messageHasImage([{ role: "user", content: "https://example.com/some-page" }])).toBe(
      false
    );
    expect(
      messageHasImage([{ role: "user", content: "https://example.com/image.png?raw=1" }])
    ).toBe(true);
    expect(
      messageHasImage([
        { role: "user", content: "Here is the screenshot: https://example.com/a.webp" },
      ])
    ).toBe(true);
    expect(messageHasImage([{ role: "user", content: "data:image/png;base64,abc123" }])).toBe(true);
  });
});
