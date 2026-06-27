import type { LanguageModelV4 } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ProviderFactory,
  ProviderFactoryLoader,
  ProviderFactoryOptions,
  ProviderSDK,
} from "../provider/registry.ts";
import { BUNDLED_PROVIDERS } from "../provider/registry.ts";
import type { ResolveOptions } from "../provider/resolve.ts";
import {
  clearResolveCache,
  resolveBaseURL,
  resolveLanguageModel,
} from "../provider/resolve.ts";
import type { Model } from "../types.ts";

// ─── test helpers ───────────────────────────────────────────────────────────

/** Minimal fake LanguageModelV4 so we can assert identity without a real SDK. */
function fakeLanguageModel(provider: string, modelId: string): LanguageModelV4 {
  return {
    modelId,
    provider,
    specificationVersion: "v4",
  } as LanguageModelV4;
}

/**
 * Build a fake factory that records every call. Returns the factory plus the
 * recorded calls so tests can assert on what the resolver passed through.
 */
function recordingFactory(provider: string): {
  calls: ProviderFactoryOptions[];
  languageModelIds: string[];
  factory: ProviderFactory;
} {
  const calls: ProviderFactoryOptions[] = [];
  const languageModelIds: string[] = [];
  const sdk: ProviderSDK = {
    languageModel(modelId: string): LanguageModelV4 {
      languageModelIds.push(modelId);
      return fakeLanguageModel(provider, modelId);
    },
  };
  return {
    calls,
    factory: (opts: ProviderFactoryOptions) => {
      calls.push(opts);
      return sdk;
    },
    languageModelIds,
  };
}

const baseModel: Model = {
  api: "ai-sdk",
  baseUrl: "https://api.anthropic.com",
  contextWindow: 200_000,
  cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
  id: "claude-sonnet-4.5",
  input: ["text", "image"],
  maxTokens: 8192,
  name: "Claude Sonnet 4.5",
  npm: "@ai-sdk/anthropic",
  provider: "anthropic",
  reasoning: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// resolveBaseURL — pure ${VAR} substitution
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveBaseURL", () => {
  it("substitutes ${VAR} from the env map", () => {
    const result = resolveBaseURL("https://${REGION}.example.com/v1", {
      REGION: "us-east-1",
    });
    expect(result).toBe("https://us-east-1.example.com/v1");
  });

  it("leaves unmatched ${VAR} as-is when env has no value", () => {
    const result = resolveBaseURL("https://${UNKNOWN}.example.com", {});
    expect(result).toBe("https://${UNKNOWN}.example.com");
  });

  it("substitutes multiple variables in one URL", () => {
    const result = resolveBaseURL("https://${SUBDOMAIN}.${HOST}/${PATH}", {
      HOST: "api.example.com",
      PATH: "v1",
      SUBDOMAIN: "us",
    });
    expect(result).toBe("https://us.api.example.com/v1");
  });

  it("returns the URL unchanged when it has no variables", () => {
    const result = resolveBaseURL("https://api.anthropic.com", {});
    expect(result).toBe("https://api.anthropic.com");
  });

  it("returns undefined for an empty URL string", () => {
    const result = resolveBaseURL("", {});
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveLanguageModel — factory dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveLanguageModel", () => {
  beforeEach(() => {
    clearResolveCache();
  });

  it("looks up the factory by model.npm and calls .languageModel(model.id)", async () => {
    const rec = recordingFactory("anthropic");
    const factories: Record<string, ProviderFactoryLoader> = {
      "@ai-sdk/anthropic": () => Promise.resolve(rec.factory),
    };
    const result = await resolveLanguageModel(
      baseModel,
      { apiKey: "sk-test" },
      factories
    );
    expect(rec.languageModelIds).toEqual(["claude-sonnet-4.5"]);
    expect(result.modelId).toBe("claude-sonnet-4.5");
    expect(result.provider).toBe("anthropic");
  });

  it("passes apiKey from options to the factory", async () => {
    const rec = recordingFactory("anthropic");
    const factories = {
      "@ai-sdk/anthropic": () => Promise.resolve(rec.factory),
    };
    await resolveLanguageModel(baseModel, { apiKey: "sk-test-key" }, factories);
    expect(rec.calls[0]?.apiKey).toBe("sk-test-key");
  });

  it("passes the resolved baseURL to the factory (with env substitution)", async () => {
    const rec = recordingFactory("cloudflare");
    const factories = {
      "@ai-sdk/openai-compatible": () => Promise.resolve(rec.factory),
    };
    const model: Model = {
      ...baseModel,
      baseUrl:
        "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
      npm: "@ai-sdk/openai-compatible",
      provider: "cloudflare-workers-ai",
    };
    await resolveLanguageModel(
      model,
      { env: { CLOUDFLARE_ACCOUNT_ID: "abc123" } },
      factories
    );
    expect(rec.calls[0]?.baseURL).toBe(
      "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1"
    );
  });

  it("options.baseURL overrides model.baseUrl", async () => {
    const rec = recordingFactory("anthropic");
    const factories = {
      "@ai-sdk/anthropic": () => Promise.resolve(rec.factory),
    };
    await resolveLanguageModel(
      baseModel,
      { baseURL: "https://custom.example.com" },
      factories
    );
    expect(rec.calls[0]?.baseURL).toBe("https://custom.example.com");
  });

  it("empty-string options.baseURL falls back to model.baseUrl (B7)", async () => {
    // `??` would keep "" (not nullish), then resolveBaseURL("") → undefined,
    // silently losing the model's real URL. Empty must be treated as unset.
    const rec = recordingFactory("anthropic");
    const factories = {
      "@ai-sdk/anthropic": () => Promise.resolve(rec.factory),
    };
    await resolveLanguageModel(baseModel, { baseURL: "" }, factories);
    expect(rec.calls[0]?.baseURL).toBe("https://api.anthropic.com");
  });

  it("passes model.provider as the factory name", async () => {
    const rec = recordingFactory("anthropic");
    const factories = {
      "@ai-sdk/anthropic": () => Promise.resolve(rec.factory),
    };
    await resolveLanguageModel(baseModel, {}, factories);
    expect(rec.calls[0]?.name).toBe("anthropic");
  });

  it("merges model.headers into options.headers (model wins on conflict)", async () => {
    const rec = recordingFactory("anthropic");
    const factories = {
      "@ai-sdk/anthropic": () => Promise.resolve(rec.factory),
    };
    const model: Model = {
      ...baseModel,
      headers: { "X-Model-Header": "from-model", "X-Shared": "from-model" },
    };
    const options: ResolveOptions = {
      headers: {
        "X-Options-Header": "from-options",
        "X-Shared": "from-options",
      },
    };
    await resolveLanguageModel(model, options, factories);
    expect(rec.calls[0]?.headers).toEqual({
      "X-Model-Header": "from-model",
      "X-Options-Header": "from-options",
      "X-Shared": "from-model",
    });
  });

  it("does not pass headers key when neither model nor options set headers", async () => {
    const rec = recordingFactory("anthropic");
    const factories = {
      "@ai-sdk/anthropic": () => Promise.resolve(rec.factory),
    };
    await resolveLanguageModel(baseModel, {}, factories);
    expect(rec.calls[0]?.headers).toBeUndefined();
  });

  it("force-enables includeUsage for @ai-sdk/openai-compatible (B2)", async () => {
    const rec = recordingFactory("deepseek");
    const factories = {
      "@ai-sdk/openai-compatible": () => Promise.resolve(rec.factory),
    };
    const model: Model = {
      ...baseModel,
      baseUrl: "https://api.deepseek.com",
      npm: "@ai-sdk/openai-compatible",
      provider: "deepseek",
    };
    await resolveLanguageModel(model, { apiKey: "sk-test" }, factories);
    // Without includeUsage, openai-compatible providers may silently return
    // zero usage, breaking cost tracking. opencode forces this on too
    // (plugin/provider/openai-compatible.ts).
    expect(rec.calls[0]?.includeUsage).toBe(true);
  });

  it("does not set includeUsage for first-party @ai-sdk factories", async () => {
    const rec = recordingFactory("anthropic");
    const factories = {
      "@ai-sdk/anthropic": () => Promise.resolve(rec.factory),
    };
    await resolveLanguageModel(baseModel, { apiKey: "sk-test" }, factories);
    // includeUsage is an openai-compatible-specific setting; first-party
    // factories (anthropic, openai, google, …) report usage natively.
    expect(rec.calls[0]?.includeUsage).toBeUndefined();
  });

  it("throws a clear error when model.npm is missing", async () => {
    const model: Model = {
      api: "ai-sdk",
      baseUrl: "https://example.com",
      contextWindow: 1,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "test",
      input: ["text"],
      maxTokens: 1,
      name: "test",
      provider: "test",
      reasoning: false,
    };
    const factories: Record<string, ProviderFactoryLoader> = {};
    await expect(resolveLanguageModel(model, {}, factories)).rejects.toThrow(
      "npm"
    );
  });

  it("throws when the npm package is not in the registry and can't be imported", async () => {
    const model: Model = {
      ...baseModel,
      npm: "@ai-sdk/nonexistent-test-package",
    };
    const factories: Record<string, ProviderFactoryLoader> = {};
    await expect(resolveLanguageModel(model, {}, factories)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUNDLED_PROVIDERS registry
// ─────────────────────────────────────────────────────────────────────────────

describe("BUNDLED_PROVIDERS registry", () => {
  it("has entries for the first-party @ai-sdk providers our catalog references", () => {
    const expectedNpm = [
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@ai-sdk/google-vertex",
      "@ai-sdk/azure",
      "@ai-sdk/amazon-bedrock",
      "@ai-sdk/mistral",
      "@ai-sdk/openai-compatible",
      "@ai-sdk/xai",
      "@ai-sdk/gateway",
    ];
    for (const npm of expectedNpm) {
      expect(BUNDLED_PROVIDERS[npm], `missing ${npm}`).toBeDefined();
      expect(typeof BUNDLED_PROVIDERS[npm]).toBe("function");
    }
  });
});
