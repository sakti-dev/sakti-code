/**
 * Image Utilities
 *
 * Functions for extracting and manipulating images from prompts.
 */

import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { Intent, NormalizeImage, VisionImage } from "./types";

/**
 * Extract images and text from a prompt
 */
export function extractImagesAndText(
  prompt: LanguageModelV3Prompt,
  normalizeImage?: NormalizeImage
): {
  hasImages: boolean;
  images: VisionImage[];
  userText: string;
} {
  const images: VisionImage[] = [];
  let userText = "";

  for (const message of prompt) {
    if (message.role === "user") {
      for (const part of message.content) {
        if (part.type === "text") {
          userText += part.text;
        } else if (part.type === "file") {
          const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          let data: string | Uint8Array;
          let mediaType = part.mediaType;

          // Handle URL-based images
          if (part.data instanceof URL) {
            const urlStr = part.data.toString();
            if (urlStr.startsWith("data:")) {
              // Extract media type and data from data URL
              const match = urlStr.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                mediaType = match[1];
                data = match[2];
              } else {
                data = urlStr;
              }
            } else {
              data = urlStr;
            }
          } else {
            data = part.data;
          }

          let image: VisionImage = { id, data, mediaType };

          // Apply normalization if provided
          if (normalizeImage) {
            image = normalizeImage(image);
          }

          images.push(image);
        }
      }
    }
  }

  return {
    hasImages: images.length > 0,
    images,
    userText: userText.trim(),
  };
}

/**
 * Strip image parts from a prompt for text model use
 */
export function stripImageParts(prompt: LanguageModelV3Prompt): LanguageModelV3Prompt {
  return prompt.map(message => {
    if (message.role === "user") {
      const content = message.content;
      if (typeof content === "string") {
        return message;
      }
      const filteredContent = content.filter(part => part.type !== "file");

      // If all parts were images, add a placeholder text
      if (filteredContent.length === 0) {
        return {
          role: "user",
          content: [{ type: "text", text: "[Image analyzed - results provided separately]" }],
        };
      }

      return {
        role: "user",
        content: filteredContent,
      };
    }
    return message;
  });
}

/**
 * Select vision strategy based on intent and user text
 */
export function selectVisionStrategy(intent: Intent, userText: string): "multi" | "per-image" {
  // Compare intent or user text mentions comparison
  if (
    intent.id === "ui-diff" ||
    /compare|difference|diff|before.?after|vs\.?|versus/i.test(userText)
  ) {
    return "multi";
  }

  // Default to per-image processing
  return "per-image";
}

/**
 * Check if a prompt contains image parts
 */
export function hasImageParts(prompt: LanguageModelV3Prompt): boolean {
  for (const message of prompt) {
    if (message.role === "user") {
      const content = message.content;
      if (typeof content === "string") {
        continue;
      }
      for (const part of content) {
        if (part.type === "file") {
          return true;
        }
      }
    }
  }
  return false;
}
