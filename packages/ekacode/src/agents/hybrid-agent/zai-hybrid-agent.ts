/**
 * Z.ai Hybrid Agent Factory
 *
 * Convenience factory for creating hybrid agents with Z.ai models.
 */

import type { ZaiChatModelId } from "@ekacode/zai";
import { createZai } from "@ekacode/zai";
import { HybridAgent } from "./hybrid-agent";
import { createPromptRegistry } from "./prompt-registry";
import {
  DATA_VIZ_ANALYSIS_PROMPT,
  DIAGRAM_UNDERSTANDING_PROMPT,
  ERROR_DIAGNOSIS_PROMPT,
  GENERAL_IMAGE_ANALYSIS_PROMPT,
  TEXT_EXTRACTION_PROMPT,
  UI_DIFF_CHECK_PROMPT,
  UI_TO_ARTIFACT_PROMPTS,
} from "./prompts";
import type { PromptRegistry } from "./types";

/**
 * Build the MCP-compatible prompt registry
 *
 * This registry mirrors the MCP server tool behavior with all
 * specialized prompts for different analysis types.
 */
export function buildMcpPromptRegistry(): PromptRegistry {
  const registry = createPromptRegistry();

  // ui_to_artifact (variants)
  registry.register({
    id: "ui-to-artifact",
    description: "Convert UI screenshots to code/prompts/specs/descriptions",
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
      "mockup",
      "wireframe",
      "prototype",
    ],
    requiredMedia: "image",
    minImages: 1,
    resolve: ({ userText, promptParams }) => {
      const outputType = String(promptParams?.output_type ?? "code");
      const system = UI_TO_ARTIFACT_PROMPTS[outputType] ?? UI_TO_ARTIFACT_PROMPTS.code;
      const outputFormat = outputType === "code" ? "code" : "markdown";
      return { system, user: userText, outputFormat };
    },
  });

  // text_extraction (parameterized)
  registry.register({
    id: "text-extraction",
    description: "Extract text from screenshots (OCR)",
    keywords: ["extract", "ocr", "read", "text", "copy", "transcribe", "what does it say"],
    requiredMedia: "image",
    minImages: 1,
    resolve: ({ userText, promptParams }) => {
      const lang = promptParams?.programming_language as string | undefined;
      const user = lang
        ? `${userText}\n\n<language_hint>The code is in ${lang}.</language_hint>`
        : userText;
      return { system: TEXT_EXTRACTION_PROMPT, user, outputFormat: "text" };
    },
  });

  // error_diagnosis
  registry.register({
    id: "error-diagnosis",
    description: "Diagnose and explain errors from screenshots",
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
    ],
    requiredMedia: "image",
    minImages: 1,
    resolve: ({ userText, promptParams }) => {
      const context = promptParams?.context as string | undefined;
      const user = context ? `${userText}\n\n<context>${context}</context>` : userText;
      return { system: ERROR_DIAGNOSIS_PROMPT, user, outputFormat: "markdown" };
    },
  });

  // diagram_analysis
  registry.register({
    id: "diagram-analysis",
    description: "Understand and explain technical diagrams",
    keywords: [
      "diagram",
      "chart",
      "flowchart",
      "architecture",
      "explain",
      "understand",
      "analyze",
      "structure",
    ],
    requiredMedia: "image",
    minImages: 1,
    resolve: ({ userText, promptParams }) => {
      const diagramType = promptParams?.diagram_type as string | undefined;
      const user = diagramType
        ? `${userText}\n\n<diagram_type>${diagramType}</diagram_type>`
        : userText;
      return { system: DIAGRAM_UNDERSTANDING_PROMPT, user, outputFormat: "markdown" };
    },
  });

  // data_viz
  registry.register({
    id: "data-viz",
    description: "Analyze data visualizations, charts, and graphs",
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
    requiredMedia: "image",
    minImages: 1,
    resolve: ({ userText, promptParams }) => {
      const focus = promptParams?.analysis_focus as string | undefined;
      const user = focus ? `${userText}\n\n<analysis_focus>${focus}</analysis_focus>` : userText;
      return { system: DATA_VIZ_ANALYSIS_PROMPT, user, outputFormat: "markdown" };
    },
  });

  // ui_diff
  registry.register({
    id: "ui-diff",
    description: "Compare two UI screenshots and identify differences",
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
    requiredMedia: "image",
    minImages: 2,
    resolve: ({ userText }) => ({
      system: UI_DIFF_CHECK_PROMPT,
      user: userText,
      outputFormat: "markdown",
    }),
  });

  // general_image (fallback)
  registry.register({
    id: "general-image",
    description: "General image analysis when no specific intent is detected",
    keywords: [],
    requiredMedia: "none",
    resolve: ({ userText }) => ({
      system: GENERAL_IMAGE_ANALYSIS_PROMPT,
      user: userText,
      outputFormat: "markdown",
    }),
  });

  return registry;
}

/**
 * Z.ai-specific options for creating a hybrid agent
 */
export interface ZaiHybridAgentOptions {
  /**
   * API key for Z.ai (defaults to ZAI_API_KEY env var)
   */
  apiKey?: string;

  /**
   * Base URL override
   */
  baseURL?: string;

  /**
   * Endpoint selection
   */
  endpoint?: "general" | "coding";

  /**
   * Text model ID (defaults to glm-4.7)
   */
  textModelId?: ZaiChatModelId;

  /**
   * Vision model ID (defaults to glm-4.6v)
   */
  visionModelId?: ZaiChatModelId;

  /**
   * Agent model ID (defaults to "zai.hybrid")
   */
  agentModelId?: string;

  /**
   * Custom prompt registry (defaults to MCP-compatible registry)
   */
  promptRegistry?: PromptRegistry;
}

/**
 * Create a Z.ai hybrid agent
 *
 * Convenience function that creates a hybrid agent pre-configured
 * with Z.ai text and vision models.
 */
export function createZaiHybridAgent(options: ZaiHybridAgentOptions = {}): HybridAgent {
  const {
    apiKey,
    baseURL,
    endpoint,
    textModelId = "glm-4.7",
    visionModelId = "glm-4.6v",
    agentModelId = "zai.hybrid",
    promptRegistry,
  } = options;

  // Create Z.ai provider
  const provider = createZai({
    apiKey,
    baseURL,
    endpoint,
  });

  // Create models
  const textModel = provider(textModelId);
  const visionModel = provider(visionModelId);

  // Create or use provided prompt registry
  const loadPrompts = () => promptRegistry ?? buildMcpPromptRegistry();

  // Image normalization for Z.ai (strip data:image prefix)
  const normalizeImage = (image: { id: string; data: string | Uint8Array; mediaType: string }) => {
    if (typeof image.data === "string" && image.data.startsWith("data:image/")) {
      return {
        ...image,
        data: image.data.replace(/^data:image\/.*;base64,/, ""),
      };
    }
    return image;
  };

  // Create and return hybrid agent
  return new HybridAgent({
    modelId: agentModelId,
    textModel,
    visionModel,
    loadPrompts,
    normalizeImage,
  });
}
