import { describe, expect, it } from "vite-plus/test";
import { convertModelsDevModel } from "../convert.ts";
import type { ModelsDevModel, ModelsDevProvider } from "../types.ts";

const zaiProvider: ModelsDevProvider = {
  id: "zai",
  name: "Z.ai",
  npm: "@ai-sdk/openai-compatible",
  api: "https://api.z.ai/api/paas/v4",
};

const glmModel: ModelsDevModel = {
  id: "glm-5.2",
  name: "GLM-5.2",
  tool_call: true,
  reasoning: true,
  modalities: { input: ["text"], output: ["text"] },
  limit: { context: 200_000, output: 64_000 },
  cost: { input: 1.4, output: 4.4, cache_read: 0.26 },
};

describe("convertModelsDevModel zai override", () => {
  it("repoints zai to @sakti-code/zai-anthropic + anthropic baseURL, drops compat", () => {
    const converted = convertModelsDevModel({ ...zaiProvider, id: "zai" }, glmModel)!;
    expect(converted).toBeDefined();
    expect(converted.npm).toBe("@sakti-code/zai-anthropic");
    expect(converted.baseUrl).toBe("https://api.z.ai/api/anthropic");
    expect(converted.compat).toBeUndefined();
    expect(converted.reasoning).toBe(true);
  });

  it("uses the same anthropic baseURL for zai-coding-plan (selected via API key, not URL)", () => {
    const converted = convertModelsDevModel({ ...zaiProvider, id: "zai-coding-plan" }, glmModel)!;
    expect(converted.npm).toBe("@sakti-code/zai-anthropic");
    expect(converted.baseUrl).toBe("https://api.z.ai/api/anthropic");
  });

  it("leaves a non-zai provider on @ai-sdk/openai-compatible", () => {
    const converted = convertModelsDevModel({ ...zaiProvider, id: "302ai" }, glmModel)!;
    expect(converted.npm).toBe("@ai-sdk/openai-compatible");
  });
});
