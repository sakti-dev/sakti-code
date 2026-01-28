/**
 * Hybrid Agent E2E Tests
 *
 * End-to-end tests for the hybrid agent functionality.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

// These tests verify the agent structure without requiring API calls
describe("Hybrid Agent E2E", () => {
  it("should export all public APIs", async () => {
    const hybridAgent = await import("../../../src/agents/hybrid-agent");

    // Check that all exports exist
    expect(hybridAgent.HybridAgent).toBeDefined();
    expect(hybridAgent.createPromptRegistry).toBeDefined();
    expect(hybridAgent.createEmptyPromptRegistry).toBeDefined();
    expect(hybridAgent.createZaiHybridAgent).toBeDefined();
    expect(hybridAgent.IntentClassifier).toBeDefined();
    expect(hybridAgent.buildMcpPromptRegistry).toBeDefined();
  });

  it("should export all types", async () => {
    // TypeScript types are not runtime values, so we can't test them directly
    // This test verifies the module can be imported without type errors
    const hybridAgent = await import("../../../src/agents/hybrid-agent");

    // Verify that runtime values needed for type usage are available
    expect(hybridAgent.HybridAgent).toBeDefined();
    expect(hybridAgent.IntentClassifier).toBeDefined();
    expect(hybridAgent.createPromptRegistry).toBeDefined();
  });

  it("should export utility functions", async () => {
    const hybridAgent = await import("../../../src/agents/hybrid-agent");

    // Check that all utilities are exported
    expect(hybridAgent.extractImagesAndText).toBeDefined();
    expect(hybridAgent.stripImageParts).toBeDefined();
    expect(hybridAgent.selectVisionStrategy).toBeDefined();
    expect(hybridAgent.hasImageParts).toBeDefined();
    expect(hybridAgent.injectVisionAnalysis).toBeDefined();
    expect(hybridAgent.injectVisionAnalysisInUserMessage).toBeDefined();
    expect(hybridAgent.createHybridPrompt).toBeDefined();
    expect(hybridAgent.imagesToContentParts).toBeDefined();
    expect(hybridAgent.extractTextFromContent).toBeDefined();
  });

  it("should export all prompts", async () => {
    const prompts = await import("../../../src/agents/hybrid-agent/prompts");

    // Check that all prompts are exported
    expect(prompts.UI_TO_ARTIFACT_PROMPTS).toBeDefined();
    expect(prompts.TEXT_EXTRACTION_PROMPT).toBeDefined();
    expect(prompts.ERROR_DIAGNOSIS_PROMPT).toBeDefined();
    expect(prompts.DIAGRAM_UNDERSTANDING_PROMPT).toBeDefined();
    expect(prompts.DATA_VIZ_ANALYSIS_PROMPT).toBeDefined();
    expect(prompts.UI_DIFF_CHECK_PROMPT).toBeDefined();
    expect(prompts.GENERAL_IMAGE_ANALYSIS_PROMPT).toBeDefined();
  });

  it("should create Zai hybrid agent factory", async () => {
    const { createZaiHybridAgent } =
      await import("../../../src/agents/hybrid-agent/zai-hybrid-agent");

    // The factory should be a function
    expect(typeof createZaiHybridAgent).toBe("function");
  });

  it("should build MCP prompt registry with all intents", async () => {
    const { buildMcpPromptRegistry } =
      await import("../../../src/agents/hybrid-agent/zai-hybrid-agent");

    const registry = buildMcpPromptRegistry();
    const intents = registry.list();

    // Should have all 7 intents
    expect(intents.length).toBeGreaterThanOrEqual(7);

    const intentIds = intents.map(h => h.id);
    expect(intentIds).toContain("ui-to-artifact");
    expect(intentIds).toContain("text-extraction");
    expect(intentIds).toContain("error-diagnosis");
    expect(intentIds).toContain("diagram-analysis");
    expect(intentIds).toContain("data-viz");
    expect(intentIds).toContain("ui-diff");
    expect(intentIds).toContain("general-image");
  });
});

describe("HybridAgent class", () => {
  it("should be instantiable with correct properties", async () => {
    const { HybridAgent } = await import("../../../src/agents/hybrid-agent/hybrid-agent");

    // Mock models
    const mockModel = {
      specificationVersion: "v3" as const,
      modelId: "mock",
      provider: "mock",
      supportedUrls: { "image/*": [] },
      async doGenerate() {
        return {
          content: [],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
            raw: undefined,
          },
          warnings: [],
        };
      },
      async doStream() {
        return {
          stream: new ReadableStream(),
          request: { body: undefined },
          response: { headers: {} },
        };
      },
    };

    const registry = (
      await import("../../../src/agents/hybrid-agent/prompt-registry")
    ).createPromptRegistry();

    const agent = new HybridAgent({
      textModel: mockModel as unknown as LanguageModelV3,
      visionModel: mockModel as unknown as LanguageModelV3,
      loadPrompts: () => registry,
    });

    expect(agent.specificationVersion).toBe("v3");
    expect(agent.modelId).toBe("hybrid");
    expect(agent.provider).toBe("hybrid");
    expect(agent.supportedUrls).toBeDefined();
  });
});
