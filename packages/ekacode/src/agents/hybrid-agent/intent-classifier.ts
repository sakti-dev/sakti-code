/**
 * Intent Classifier
 *
 * Classify user intents for prompt selection.
 */

import type { LanguageModelV3, LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { Intent, IntentId, PromptRegistry } from "./types";

/**
 * Intent classification result with optional parameters
 */
export interface ClassificationResult {
  intent: Intent;
  promptParams?: Record<string, unknown>;
}

/**
 * Intent keywords for each intent type
 */
const INTENT_KEYWORDS: Record<
  string,
  { keywords: string[]; requiresMedia: "image" | "video" | "none"; minImages?: number }
> = {
  "ui-to-artifact": {
    keywords: [
      "implement",
      "code",
      "build",
      "create",
      "component",
      "react",
      "vue",
      "frontend",
      "ui",
      "interface",
      "design system",
      "mockup",
      "wireframe",
      "prototype",
    ],
    requiresMedia: "image",
    minImages: 1,
  },
  "text-extraction": {
    keywords: [
      "extract",
      "ocr",
      "read",
      "text",
      "copy",
      "transcribe",
      "what does it say",
      "read the text",
    ],
    requiresMedia: "image",
    minImages: 1,
  },
  "error-diagnosis": {
    keywords: [
      "error",
      "bug",
      "fix",
      "debug",
      "diagnose",
      "help",
      "issue",
      "problem",
      "not working",
      "failed",
      "exception",
      "stack trace",
    ],
    requiresMedia: "image",
    minImages: 1,
  },
  "diagram-analysis": {
    keywords: [
      "diagram",
      "chart",
      "flowchart",
      "architecture",
      "explain",
      "understand",
      "what is this",
      "analyze",
      "structure",
    ],
    requiresMedia: "image",
    minImages: 1,
  },
  "data-viz": {
    keywords: [
      "data",
      "chart",
      "graph",
      "visualization",
      "analytics",
      "trends",
      "statistics",
      "insights",
      "plot",
    ],
    requiresMedia: "image",
    minImages: 1,
  },
  "ui-diff": {
    keywords: [
      "compare",
      "difference",
      "diff",
      "before after",
      "vs",
      "versus",
      "changed",
      "different",
    ],
    requiresMedia: "image",
    minImages: 2,
  },
};

/**
 * Get all available intent IDs
 */
export function getAvailableIntents(): IntentId[] {
  return [...Object.keys(INTENT_KEYWORDS), "general-image"] as IntentId[];
}

/**
 * Get intent keywords
 */
export function getIntentKeywords(intentId: IntentId): string[] {
  return INTENT_KEYWORDS[intentId]?.keywords ?? [];
}

/**
 * Simple keyword-based intent classification
 */
export function classifyByKeywords(userText: string, imageCount: number): IntentId {
  const normalizedText = userText.toLowerCase();

  // Check for diff intent (requires 2+ images)
  if (imageCount >= 2) {
    const diffKeywords = INTENT_KEYWORDS["ui-diff"].keywords;
    if (diffKeywords.some(kw => normalizedText.includes(kw))) {
      return "ui-diff";
    }
  }

  // Score each intent based on keyword matches
  const scores: Record<string, number> = {};
  for (const [intentId, config] of Object.entries(INTENT_KEYWORDS)) {
    // For ui-diff, we already handled it above
    if (intentId === "ui-diff") {
      continue;
    }

    // Check minimum image requirement (but still score for potential matching)
    if (config.minImages && imageCount < config.minImages) {
      // Skip intents that require images when we don't have enough
      continue;
    }

    // Count keyword matches
    let score = 0;
    for (const keyword of config.keywords) {
      if (normalizedText.includes(keyword)) {
        score += 1;
      }
    }
    if (score > 0) {
      scores[intentId] = score;
    }
  }

  // Return intent with highest score
  if (Object.keys(scores).length === 0) {
    return "general-image";
  }

  const sortedIntents = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sortedIntents[0][0] as IntentId;
}

/**
 * Intent Classifier class
 *
 * Uses keyword-based classification with optional model-based enhancement.
 */
export class IntentClassifier {
  constructor(
    private textModel: LanguageModelV3,
    private promptRegistry: PromptRegistry
  ) {}

  /**
   * Classify intent from prompt
   */
  async classify(prompt: LanguageModelV3Prompt): Promise<Intent> {
    // Extract user text and image count
    let userText = "";
    let imageCount = 0;

    for (const message of prompt) {
      if (message.role === "user") {
        for (const part of message.content) {
          if (part.type === "text") {
            userText += part.text + " ";
          } else if (part.type === "file") {
            imageCount++;
          }
        }
      }
    }

    userText = userText.trim();

    // Use keyword-based classification
    const intentId = classifyByKeywords(userText, imageCount);

    // Get intent confidence (simple scoring)
    const handler = this.promptRegistry.get(intentId);
    const confidence = handler ? 0.85 : 0.5;

    return {
      id: intentId,
      confidence,
      reasoning: `Classified based on keyword analysis and image count (${imageCount} image(s))`,
    };
  }

  /**
   * Classify intent with parameters
   */
  async classifyWithParams(prompt: LanguageModelV3Prompt): Promise<ClassificationResult> {
    const intent = await this.classify(prompt);

    // Extract prompt parameters based on intent
    const promptParams = this.extractPromptParams(prompt, intent.id);

    return {
      intent,
      promptParams,
    };
  }

  /**
   * Extract prompt parameters from the prompt
   */
  private extractPromptParams(
    prompt: LanguageModelV3Prompt,
    intentId: IntentId
  ): Record<string, unknown> | undefined {
    // Extract user text for parameter extraction
    let userText = "";
    for (const message of prompt) {
      if (message.role === "user") {
        for (const part of message.content) {
          if (part.type === "text") {
            userText += part.text + " ";
          }
        }
      }
    }

    const normalizedText = userText.toLowerCase();

    // Intent-specific parameter extraction
    switch (intentId) {
      case "ui-to-artifact":
        // Check for output type hints
        if (/\bcode\b/.test(normalizedText)) {
          return { output_type: "code" };
        }
        if (/\bprompt\b/.test(normalizedText)) {
          return { output_type: "prompt" };
        }
        if (/\bspec\b|\bdocumentation\b/.test(normalizedText)) {
          return { output_type: "spec" };
        }
        if (/\bdescribe\b|\bdescription\b/.test(normalizedText)) {
          return { output_type: "description" };
        }
        return { output_type: "code" };

      case "text-extraction":
        // Check for programming language hints
        const langMatch = userText.match(
          /(?:language|lang|code is in|written in)\s*[::]?\s*(\w+)/i
        );
        if (langMatch) {
          return { programming_language: langMatch[1] };
        }
        return undefined;

      case "error-diagnosis":
        // Check for context hints
        if (/\bwhile\b.*\b(ing|ing)\b|\bwhen\b.*\bing\b/i.test(userText)) {
          return { context: "during execution" };
        }
        return undefined;

      case "diagram-analysis":
        // Check for diagram type hints
        if (/\bflowchart\b/i.test(normalizedText)) {
          return { diagram_type: "flowchart" };
        }
        if (/\bsequence\b/i.test(normalizedText)) {
          return { diagram_type: "sequence" };
        }
        if (/\barchitecture\b/i.test(normalizedText)) {
          return { diagram_type: "architecture" };
        }
        return undefined;

      case "data-viz":
        // Check for analysis focus hints
        if (/\btrend?\b/i.test(normalizedText)) {
          return { analysis_focus: "trends" };
        }
        if (/\b(?:anomaly|outlier)\b/i.test(normalizedText)) {
          return { analysis_focus: "anomalies" };
        }
        return undefined;

      default:
        return undefined;
    }
  }
}
