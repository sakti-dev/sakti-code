/**
 * Prompt Injector Tests
 *
 * TDD tests for prompt injection functionality.
 */

import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
  createHybridPrompt,
  injectVisionAnalysis,
  injectVisionAnalysisInUserMessage,
} from "../../../src/agents/hybrid-agent/prompt-injector.js";

describe("Prompt Injector", () => {
  const basePrompt: LanguageModelV3Prompt = [
    { role: "system" as const, content: "You are helpful." },
    {
      role: "user" as const,
      content: [{ type: "text", text: "What's in this image?" }],
    },
  ];

  describe("injectVisionAnalysis", () => {
    it("should inject analysis as system message at beginning", () => {
      const analysis = "The image shows a blue button with white text.";

      const result = injectVisionAnalysis({ prompt: basePrompt, analysis });

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        role: "system",
        content:
          "[Vision Analysis Result]\n\nThe image shows a blue button with white text.\n\nUse this vision analysis to inform your response to the user.",
      });
      expect(result[1]).toEqual(basePrompt[0]);
      expect(result[2]).toEqual(basePrompt[1]);
    });

    it("should preserve original prompt order", () => {
      const analysis = "Analysis complete.";

      const result = injectVisionAnalysis({ prompt: basePrompt, analysis });

      expect(result[0]).not.toEqual(basePrompt[0]); // New system message
      expect(result[1]).toEqual(basePrompt[0]); // Original system
      expect(result[2]).toEqual(basePrompt[1]); // Original user
    });
  });

  describe("injectVisionAnalysisInUserMessage", () => {
    it("should append analysis to last user message", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [{ type: "text", text: "Analyze this please." }],
        },
      ];

      const analysis = "The image contains a form.";

      const result = injectVisionAnalysisInUserMessage({ prompt, analysis });

      expect(result).toHaveLength(1);
      const content = result[0].content as string;
      expect(content).toContain("Analyze this please.");
      expect(content).toContain("\n\n---\n\n[Image Analysis]\nThe image contains a form.");
    });

    it("should append to existing text in user message", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [{ type: "text", text: "Hello" }],
        },
      ];

      const analysis = "Analysis here";

      const result = injectVisionAnalysisInUserMessage({ prompt, analysis });

      const content = result[0].content as string;
      expect(content).toBe("Hello\n\n---\n\n[Image Analysis]\nAnalysis here");
    });

    it("should handle empty content array", () => {
      const prompt: LanguageModelV3Prompt = [{ role: "user" as const, content: [] }];

      const result = injectVisionAnalysisInUserMessage({
        prompt,
        analysis: "Analysis",
      });

      expect(result[0].content).toEqual([
        { type: "text", text: "\n\n---\n\n[Image Analysis]\nAnalysis" },
      ]);
    });

    it("should handle string content", () => {
      const prompt = [
        { role: "user" as const, content: "Existing content" },
      ] as unknown as LanguageModelV3Prompt;

      const result = injectVisionAnalysisInUserMessage({
        prompt,
        analysis: "New analysis",
      });

      expect(result[0].content).toBe("Existing content\n\n---\n\n[Image Analysis]\nNew analysis");
    });
  });

  describe("createHybridPrompt", () => {
    it("should be alias for injectVisionAnalysis", () => {
      const analysis = "Vision result";

      const result1 = injectVisionAnalysis({ prompt: basePrompt, analysis });
      const result2 = createHybridPrompt({ originalPrompt: basePrompt, visionAnalysis: analysis });

      expect(result1).toEqual(result2);
    });
  });
});
