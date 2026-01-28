/**
 * Image Utilities Tests
 *
 * TDD tests for image extraction and manipulation.
 */

import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
  extractImagesAndText,
  hasImageParts,
  selectVisionStrategy,
  stripImageParts,
} from "../../../src/agents/hybrid-agent/image-utils.js";

describe("Image Utilities", () => {
  describe("extractImagesAndText", () => {
    it("should extract text from simple prompt", () => {
      const prompt: LanguageModelV3Prompt = [
        { role: "user" as const, content: [{ type: "text", text: "Hello world" }] },
      ];

      const result = extractImagesAndText(prompt);

      expect(result.hasImages).toBe(false);
      expect(result.images).toEqual([]);
      expect(result.userText).toBe("Hello world");
    });

    it("should extract image from data URL", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [
            { type: "text", text: "Analyze this" },
            {
              type: "file",
              data: "data:image/png;base64,iVBORw0KGgo...",
              mediaType: "image/png",
            },
          ],
        },
      ];

      const result = extractImagesAndText(prompt);

      expect(result.hasImages).toBe(true);
      expect(result.images).toHaveLength(1);
      expect(result.images[0].mediaType).toBe("image/png");
      expect(result.userText).toBe("Analyze this");
    });

    it("should extract multiple images", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [
            {
              type: "file",
              data: "data:image/png;base64,abc123",
              mediaType: "image/png",
            },
            {
              type: "file",
              data: "data:image/jpeg;base64,def456",
              mediaType: "image/jpeg",
            },
          ],
        },
      ];

      const result = extractImagesAndText(prompt);

      expect(result.hasImages).toBe(true);
      expect(result.images).toHaveLength(2);
    });

    it("should apply normalizeImage function when provided", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [
            { type: "text", text: "Analyze" },
            {
              type: "file",
              data: "data:image/png;base64,abc123",
              mediaType: "image/png",
            },
          ],
        },
      ];

      const normalizeImage = (image: {
        id: string;
        data: string | Uint8Array;
        mediaType: string;
      }) => ({
        ...image,
        data:
          typeof image.data === "string"
            ? image.data.replace(/^data:image\/.*;base64,/, "")
            : image.data,
      });

      const result = extractImagesAndText(prompt, normalizeImage);

      expect(result.images[0].data).toBe("abc123");
    });
  });

  describe("stripImageParts", () => {
    it("should remove image parts from prompt", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [
            { type: "text", text: "Hello" },
            { type: "file", data: "abc", mediaType: "image/png" },
          ],
        },
      ];

      const stripped = stripImageParts(prompt);

      expect(stripped).toHaveLength(1);
      expect(stripped[0].content).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("should add placeholder when all content is images", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [{ type: "file", data: "abc", mediaType: "image/png" }],
        },
      ];

      const stripped = stripImageParts(prompt);

      expect(stripped[0].content).toEqual([
        { type: "text", text: "[Image analyzed - results provided separately]" },
      ]);
    });

    it("should preserve non-user messages", () => {
      const prompt: LanguageModelV3Prompt = [
        { role: "system" as const, content: "You are helpful." },
        {
          role: "user" as const,
          content: [
            { type: "text", text: "Analyze this" },
            { type: "file", data: "abc", mediaType: "image/png" },
          ],
        },
        {
          role: "assistant" as const,
          content: [{ type: "text", text: "I see..." }],
        },
      ];

      const stripped = stripImageParts(prompt);

      expect(stripped).toHaveLength(3);
      expect(stripped[0]).toEqual({ role: "system", content: "You are helpful." });
      expect(stripped[2]).toEqual({
        role: "assistant",
        content: [{ type: "text", text: "I see..." }],
      });
    });
  });

  describe("selectVisionStrategy", () => {
    it("should return 'multi' for ui-diff intent", () => {
      const strategy = selectVisionStrategy({ id: "ui-diff", confidence: 0.9 }, "Compare these");
      expect(strategy).toBe("multi");
    });

    it("should return 'multi' for compare keyword", () => {
      const strategy = selectVisionStrategy(
        { id: "general-image", confidence: 0.5 },
        "What's the difference?"
      );
      expect(strategy).toBe("multi");
    });

    it("should return 'per-image' for other intents", () => {
      const strategy = selectVisionStrategy(
        { id: "ui-to-artifact", confidence: 0.9 },
        "Build this"
      );
      expect(strategy).toBe("per-image");
    });
  });

  describe("hasImageParts", () => {
    it("should return false for text-only prompt", () => {
      const prompt: LanguageModelV3Prompt = [
        { role: "user" as const, content: [{ type: "text", text: "Hello" }] },
      ];

      expect(hasImageParts(prompt)).toBe(false);
    });

    it("should return true when file part exists", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [{ type: "file", data: "abc", mediaType: "image/png" }],
        },
      ];

      expect(hasImageParts(prompt)).toBe(true);
    });

    it("should return true for mixed content", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user" as const,
          content: [
            { type: "text", text: "Hello" },
            { type: "file", data: "abc", mediaType: "image/png" },
          ],
        },
      ];

      expect(hasImageParts(prompt)).toBe(true);
    });
  });
});
