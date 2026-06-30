import { describe, expect, it } from "vite-plus/test";
import { BUNDLED_PROVIDERS } from "../provider/registry.ts";

const CATALOG_NPM_PACKAGES = [
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/amazon-bedrock/mantle",
  "@ai-sdk/anthropic",
  "@ai-sdk/azure",
  "@ai-sdk/cerebras",
  "@ai-sdk/cohere",
  "@ai-sdk/deepinfra",
  "@ai-sdk/gateway",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@ai-sdk/google-vertex/anthropic",
  "@ai-sdk/groq",
  "@ai-sdk/mistral",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/togetherai",
  "@ai-sdk/vercel",
  "@ai-sdk/xai",
  "@openrouter/ai-sdk-provider",
  "merge-gateway-ai-sdk-provider",
  "venice-ai-sdk-provider",
  "@aihubmix/ai-sdk-provider",
  "ai-gateway-provider",
  "@jerome-benoit/sap-ai-provider-v2",
  "gitlab-ai-provider",
];

describe("BUNDLED_PROVIDERS coverage", () => {
  it("has an entry for every npm package referenced in the catalog", () => {
    const missing = CATALOG_NPM_PACKAGES.filter((npm) => !(npm in BUNDLED_PROVIDERS));
    expect(missing, `Missing registry entries: ${missing.join(", ")}`).toEqual([]);
  });

  it("each loader resolves to a ProviderFactory", async () => {
    for (const [npm, loader] of Object.entries(BUNDLED_PROVIDERS)) {
      const factory = await loader();
      expect(typeof factory, `${npm} loader did not return a function`).toBe("function");
    }
  });
});
