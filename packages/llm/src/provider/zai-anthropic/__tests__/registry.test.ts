import { describe, expect, it } from "vite-plus/test";
import { BUNDLED_PROVIDERS } from "../../registry.ts";

describe("zai-anthropic registry entry", () => {
  it("resolves to a LanguageModelV4 with provider zai.messages", async () => {
    const loader = BUNDLED_PROVIDERS["@sakti-code/zai-anthropic"];
    if (!loader) {
      throw new Error("zai-anthropic loader missing");
    }
    const factory = await loader();
    const sdk = factory({
      apiKey: "k",
      baseURL: "https://api.z.ai/api/anthropic",
    });
    const model = sdk.languageModel("glm-5.2");
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("glm-5.2");
    expect(model.provider).toBe("zai.messages");
  });
});
