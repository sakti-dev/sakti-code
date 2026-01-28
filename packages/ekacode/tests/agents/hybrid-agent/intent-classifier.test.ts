/**
 * Intent Classifier Tests
 *
 * TDD tests for intent classification functionality.
 */

import type { LanguageModelV3, LanguageModelV3Prompt } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
  IntentClassifier,
  classifyByKeywords,
  getAvailableIntents,
  getIntentKeywords,
} from "../../../src/agents/hybrid-agent/intent-classifier.js";
import { createPromptRegistry } from "../../../src/agents/hybrid-agent/prompt-registry.js";

// Mock text model for testing
class MockTextModel {
  readonly specificationVersion = "v3" as const;
  readonly modelId = "mock-text";
  get provider() {
    return "mock";
  }

  async doGenerate() {
    return {
      content: [{ type: "text", text: "" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
        raw: undefined,
      },
      warnings: [],
    };
  }

  async doStream() {
    return {
      stream: new ReadableStream(),
      request: { body: undefined },
      response: { headers: {} },
    };
  }
}

describe("IntentClassifier", () => {
  describe("getAvailableIntents", () => {
    it("should return all available intent IDs", () => {
      const intents = getAvailableIntents();
      expect(intents).toContain("ui-to-artifact");
      expect(intents).toContain("text-extraction");
      expect(intents).toContain("error-diagnosis");
      expect(intents).toContain("diagram-analysis");
      expect(intents).toContain("data-viz");
      expect(intents).toContain("ui-diff");
      expect(intents).toContain("general-image");
    });
  });

  describe("getIntentKeywords", () => {
    it("should return keywords for ui-to-artifact intent", () => {
      const keywords = getIntentKeywords("ui-to-artifact");
      expect(keywords).toContain("implement");
      expect(keywords).toContain("code");
      expect(keywords).toContain("react");
    });

    it("should return keywords for text-extraction intent", () => {
      const keywords = getIntentKeywords("text-extraction");
      expect(keywords).toContain("extract");
      expect(keywords).toContain("ocr");
      expect(keywords).toContain("read");
    });
  });

  describe("classifyByKeywords", () => {
    it("should classify ui-to-artifact intent from keywords", () => {
      const intent = classifyByKeywords("Implement this React component", 1);
      expect(intent).toBe("ui-to-artifact");
    });

    it("should classify text-extraction intent from keywords", () => {
      const intent = classifyByKeywords("Extract the text from this image", 1);
      expect(intent).toBe("text-extraction");
    });

    it("should classify error-diagnosis intent from keywords", () => {
      const intent = classifyByKeywords("What's wrong with this error?", 1);
      expect(intent).toBe("error-diagnosis");
    });

    it("should classify ui-diff intent with 2+ images", () => {
      const intent = classifyByKeywords("Compare these two UIs", 2);
      expect(intent).toBe("ui-diff");
    });

    it("should fallback to general-image when no keywords match", () => {
      const intent = classifyByKeywords("xyzabc123", 1);
      expect(intent).toBe("general-image");
    });
  });

  describe("IntentClassifier class", () => {
    it("should create classifier with text model and registry", () => {
      const mockModel = new MockTextModel() as unknown as LanguageModelV3;
      const registry = createPromptRegistry();
      const classifier = new IntentClassifier(mockModel, registry);

      expect(classifier).toBeDefined();
    });

    it("should classify intent from simple prompt", async () => {
      const mockModel = new MockTextModel() as unknown as LanguageModelV3;
      const registry = createPromptRegistry();
      const classifier = new IntentClassifier(mockModel, registry);

      const prompt: LanguageModelV3Prompt = [
        { role: "user" as const, content: [{ type: "text", text: "Implement this button" }] },
      ];

      const result = await classifier.classify(prompt);

      expect(result.id).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should detect image count in prompt", async () => {
      const mockModel = new MockTextModel() as unknown as LanguageModelV3;
      const registry = createPromptRegistry();
      const classifier = new IntentClassifier(mockModel, registry);

      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [
            { type: "text", text: "What's in these images?" },
            { type: "file", data: "abc", mediaType: "image/png" },
            { type: "file", data: "def", mediaType: "image/png" },
          ],
        },
      ];

      const result = await classifier.classify(prompt);

      expect(result.reasoning).toContain("2 image");
    });
  });
});
