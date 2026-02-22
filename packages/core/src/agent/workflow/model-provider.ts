/**
 * Model provider configuration
 *
 * This module provides language model instances for each phase of the
 * workflow using Z.ai models (primary) and OpenAI (fallback).
 *
 * Model assignments:
 * - planModel: glm-4.7 (high-quality planning, equivalent to gpt-4o)
 * - buildModel: glm-4.7-flash (fast code generation, equivalent to claude-3.5-sonnet)
 * - exploreModel: glm-4.7-flashx (cost-effective exploration, equivalent to gpt-4o-mini)
 *
 * Environment variables:
 * - ZAI_API_KEY: Required for Z.ai models
 * - OPENAI_API_KEY: Optional, for OpenAI fallback
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createZai } from "@sakti-code/zai";
import { Instance } from "../../instance";
import { HybridAgent, createDefaultPromptRegistry } from "../hybrid-agent";
import { inferProviderNpmPackage, resolveProviderSdkFactory } from "./provider-sdk-registry";

// ============================================================================
// ZAI PROVIDER (Primary) - Using "coding" endpoint for better code generation
// ============================================================================

// Create Z.ai provider with coding endpoint (https://api.z.ai/api/coding/paas/v4)
const zaiCoding = createZai({ endpoint: "coding" });

// ============================================================================
// DEVELOPMENT MODE: Use single model for all phases to reduce API costs
// ============================================================================

/**
 * Development model - uses glm-4.7 for all phases
 *
 * During development, we use a single model to minimize API calls and avoid
 * rate limiting issues. In production, you may want to use different models
 * for different phases (explore: glm-4.7-flashx, plan: glm-4.7, build: glm-4.7-flash)
 */
export const devModel: LanguageModelV3 = zaiCoding("glm-4.7");

/**
 * Plan model - uses glm-4.7 for high-quality planning decisions
 */
export const planModel: LanguageModelV3 = devModel;

/**
 * Build model - uses glm-4.7 for code generation
 */
export const buildModel: LanguageModelV3 = devModel;

/**
 * Explore model - uses glm-4.7 for exploration
 */
export const exploreModel: LanguageModelV3 = devModel;

/**
 * Vision model - uses glm-4.7 for multimodal (image) understanding
 */
export const visionModel: LanguageModelV3 = zaiCoding("glm-4.6v");

// ============================================================================
// OPENAI PROVIDER (Fallback)
// ============================================================================

/**
 * OpenAI provider instance for fallback models.
 * Only initialized if OPENAI_API_KEY is set.
 */
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const providerCache = new Map<string, ReturnType<typeof createOpenAI>>();

interface RuntimeSelection {
  providerId: string;
  modelId: string;
  providerApiUrl?: string;
  providerNpmPackage?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

function getHybridVisionSelectionFromContext(): RuntimeSelection | null {
  if (!Instance.inContext) return null;
  const runtime = Instance.context.providerRuntime;
  if (!runtime?.hybridVisionEnabled) return null;
  if (!runtime.hybridVisionProviderId || !runtime.hybridVisionModelId) return null;

  const parsed = parseModelReference(runtime.hybridVisionModelId);
  const modelId =
    parsed && parsed.providerId === runtime.hybridVisionProviderId
      ? parsed.modelId
      : parsed
        ? parsed.modelId
        : runtime.hybridVisionModelId;

  return {
    providerId: runtime.hybridVisionProviderId,
    modelId,
    providerApiUrl: runtime.hybridVisionProviderApiUrl?.trim(),
    providerNpmPackage: runtime.hybridVisionProviderNpmPackage?.trim(),
    apiKey: runtime.hybridVisionApiKey?.trim(),
  };
}

function parseModelReference(
  modelReference: string
): { providerId: string; modelId: string } | null {
  const [providerId, ...rest] = modelReference.split("/");
  if (!providerId || rest.length === 0) return null;
  return { providerId, modelId: rest.join("/") };
}

function getRuntimeSelectionFromEnv(): RuntimeSelection | null {
  const contextSelection = getRuntimeSelectionFromContext();
  if (contextSelection) return contextSelection;

  const providerId = process.env.SAKTI_CODE_ACTIVE_PROVIDER_ID?.trim();
  const modelRef = process.env.SAKTI_CODE_ACTIVE_MODEL_ID?.trim();
  if (!providerId || !modelRef) return null;

  const parsed = parseModelReference(modelRef);
  const modelId =
    parsed && parsed.providerId === providerId
      ? parsed.modelId
      : parsed
        ? parsed.modelId
        : modelRef;

  return {
    providerId,
    modelId,
    providerApiUrl: process.env.SAKTI_CODE_ACTIVE_PROVIDER_API_URL?.trim(),
    providerNpmPackage: process.env.SAKTI_CODE_ACTIVE_PROVIDER_NPM?.trim(),
    apiKey: process.env.SAKTI_CODE_PROVIDER_API_KEY?.trim(),
  };
}

function getRuntimeSelectionFromContext(): RuntimeSelection | null {
  if (!Instance.inContext) return null;
  const runtime = Instance.context.providerRuntime;
  if (!runtime?.providerId || !runtime.modelId) return null;

  const parsed = parseModelReference(runtime.modelId);
  const modelId =
    parsed && parsed.providerId === runtime.providerId
      ? parsed.modelId
      : parsed
        ? parsed.modelId
        : runtime.modelId;

  return {
    providerId: runtime.providerId,
    modelId,
    providerApiUrl: runtime.providerApiUrl?.trim(),
    providerNpmPackage: runtime.providerNpmPackage?.trim(),
    apiKey: runtime.apiKey?.trim(),
    headers: runtime.headers,
  };
}

function defaultProviderHeaders(providerId: string): Record<string, string> | undefined {
  switch (providerId) {
    case "openrouter":
      return {
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      };
    case "vercel":
      return {
        "http-referer": "https://opencode.ai/",
        "x-title": "opencode",
      };
    case "zenmux":
      return {
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      };
    case "cerebras":
      return {
        "X-Cerebras-3rd-Party-Integration": "opencode",
      };
    default:
      return undefined;
  }
}

function resolveModelFromSelection(selection: RuntimeSelection): LanguageModelV3 {
  const providerNpmPackage =
    selection.providerNpmPackage?.trim() || inferProviderNpmPackage(selection.providerId);

  if (selection.providerId === "zai") {
    return createZai({
      apiKey: selection.apiKey || process.env.ZAI_API_KEY,
      endpoint: "general",
      baseURL: process.env.ZAI_BASE_URL,
    })(selection.modelId as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  if (selection.providerId === "zai-coding-plan") {
    return createZai({
      apiKey: selection.apiKey || process.env.ZAI_API_KEY,
      endpoint: "coding",
      baseURL: process.env.ZAI_BASE_URL,
    })(selection.modelId as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  const cacheKey = `${selection.providerId}|${selection.providerApiUrl ?? ""}|${selection.apiKey ?? ""}|${providerNpmPackage ?? ""}`;
  const headers = {
    ...(defaultProviderHeaders(selection.providerId) ?? {}),
    ...(selection.headers ?? {}),
  };
  const headersKey = JSON.stringify(headers);
  const finalCacheKey = `${cacheKey}|${headersKey}`;
  let provider = providerCache.get(finalCacheKey);
  if (!provider) {
    provider = resolveProviderSdkFactory({
      providerId: selection.providerId,
      providerNpmPackage,
      apiKey: selection.apiKey,
      baseURL: selection.providerApiUrl,
      headers,
    });
    providerCache.set(finalCacheKey, provider);
  }

  // OpenAI-compatible providers (eg: OpenCode Zen Kimi/GLM models) stream chat.completion chunks.
  // Routing them through `chat()` keeps parsing aligned with upstream payload format.
  if (providerNpmPackage === "@ai-sdk/openai-compatible") {
    const typedProvider = provider as unknown as {
      chat?: (id: string) => LanguageModelV3;
      languageModel?: (id: string) => LanguageModelV3;
    };
    if (typeof typedProvider.chat === "function") {
      return typedProvider.chat(selection.modelId);
    }
    if (typeof typedProvider.languageModel === "function") {
      return typedProvider.languageModel(selection.modelId);
    }
    return provider(selection.modelId);
  }

  if (providerNpmPackage === "@ai-sdk/openai") {
    const typedProvider = provider as unknown as { responses?: (id: string) => LanguageModelV3 };
    if (selection.providerId === "openai" && typeof typedProvider.responses === "function") {
      return typedProvider.responses(selection.modelId);
    }
    return provider(selection.modelId);
  }

  if (providerNpmPackage === "@ai-sdk/azure" && typeof provider.responses === "function") {
    const typedProvider = provider as unknown as { responses?: (id: string) => LanguageModelV3 };
    return typedProvider.responses!(selection.modelId);
  }

  if (providerNpmPackage === "@gitlab/gitlab-ai-provider") {
    const typedProvider = provider as unknown as { agenticChat?: (id: string) => LanguageModelV3 };
    if (typeof typedProvider.agenticChat === "function") {
      return typedProvider.agenticChat(selection.modelId);
    }
  }

  const typedProvider2 = provider as unknown as { languageModel?: (id: string) => LanguageModelV3 };
  if (typeof typedProvider2.languageModel === "function") {
    return typedProvider2.languageModel(selection.modelId);
  }

  return provider(selection.modelId);
}

export function getModelByReference(modelReference: string): LanguageModelV3 {
  const contextSelection = getRuntimeSelectionFromContext();
  if (contextSelection) {
    const parsed = parseModelReference(modelReference);
    if (parsed) {
      if (parsed.providerId !== contextSelection.providerId) {
        return resolveModelFromSelection({
          providerId: parsed.providerId,
          modelId: parsed.modelId,
        });
      }
      return resolveModelFromSelection({
        providerId: parsed.providerId,
        modelId: parsed.modelId,
        providerApiUrl: contextSelection.providerApiUrl,
        providerNpmPackage: contextSelection.providerNpmPackage,
        apiKey: contextSelection.apiKey,
        headers: contextSelection.headers,
      });
    }
    return resolveModelFromSelection(contextSelection);
  }

  const parsed = parseModelReference(modelReference);
  if (parsed) {
    return resolveModelFromSelection({
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      providerApiUrl: process.env.SAKTI_CODE_ACTIVE_PROVIDER_API_URL?.trim(),
      providerNpmPackage: process.env.SAKTI_CODE_ACTIVE_PROVIDER_NPM?.trim(),
      apiKey: process.env.SAKTI_CODE_PROVIDER_API_KEY?.trim(),
    });
  }

  const active = getRuntimeSelectionFromEnv();
  if (active) return resolveModelFromSelection(active);
  throw new Error(`Invalid model reference: ${modelReference}`);
}

/**
 * Fallback plan model using OpenAI gpt-4o
 *
 * Use this if Z.ai is unavailable or for comparison testing.
 */
export const planModelOpenAI: LanguageModelV3 = openai("gpt-4o");

/**
 * Fallback explore model using OpenAI gpt-4o-mini
 *
 * Use this if Z.ai is unavailable or for cost optimization.
 */
export const exploreModelOpenAI: LanguageModelV3 = openai("gpt-4o-mini");

// ============================================================================
// MODEL SELECTION HELPERS
// ============================================================================

/**
 * Get the appropriate plan model based on environment.
 * Prioritizes Z.ai, falls back to OpenAI if configured.
 */
export function getPlanModel(): LanguageModelV3 {
  const active = getRuntimeSelectionFromEnv();
  if (active) return resolveModelFromSelection(active);

  // Use Z.ai by default (requires ZAI_API_KEY)
  if (process.env.ZAI_API_KEY || process.env.ZAI_BASE_URL) {
    return planModel;
  }
  // Fall back to OpenAI if available
  if (process.env.OPENAI_API_KEY) {
    return planModelOpenAI;
  }
  // No provider available - will fail at runtime
  throw new Error(
    "No model provider available. Set ZAI_API_KEY or OPENAI_API_KEY environment variable."
  );
}

/**
 * Get the appropriate build model based on environment.
 * Currently only Z.ai is supported for build (optimal for code generation).
 */
export function getBuildModel(): LanguageModelV3 {
  const active = getRuntimeSelectionFromEnv();
  if (active) {
    const visionSelection = getHybridVisionSelectionFromContext();
    if (visionSelection) {
      return new HybridAgent({
        modelId: `hybrid/${active.providerId}/${active.modelId}`,
        textModel: resolveModelFromSelection(active),
        visionModel: resolveModelFromSelection(visionSelection),
        loadPrompts: () => createDefaultPromptRegistry(),
      });
    }
    return resolveModelFromSelection(active);
  }

  // Build requires Z.ai for optimal performance
  if (process.env.ZAI_API_KEY || process.env.ZAI_BASE_URL) {
    return buildModel;
  }
  throw new Error("Build model requires Z.ai provider. Set ZAI_API_KEY environment variable.");
}

/**
 * Get the appropriate explore model based on environment.
 * Prioritizes Z.ai, falls back to OpenAI if configured.
 */
export function getExploreModel(): LanguageModelV3 {
  const active = getRuntimeSelectionFromEnv();
  if (active) return resolveModelFromSelection(active);

  // Use Z.ai by default
  if (process.env.ZAI_API_KEY || process.env.ZAI_BASE_URL) {
    return exploreModel;
  }
  // Fall back to OpenAI if available
  if (process.env.OPENAI_API_KEY) {
    return exploreModelOpenAI;
  }
  throw new Error(
    "No model provider available. Set ZAI_API_KEY or OPENAI_API_KEY environment variable."
  );
}

/**
 * Get the vision model for multimodal (image) support.
 *
 * Only Z.ai supports vision models currently.
 */
export function getVisionModel(): LanguageModelV3 {
  // Vision requires Z.ai provider
  if (process.env.ZAI_API_KEY || process.env.ZAI_BASE_URL) {
    return visionModel;
  }
  throw new Error("Vision model requires Z.ai provider. Set ZAI_API_KEY environment variable.");
}

/**
 * Check if a message contains image content
 *
 * Detects when messages have image URLs or base64 image data
 * that should trigger vision model routing.
 */
export function messageHasImage(
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; [key: string]: unknown }>;
  }>
): boolean {
  for (const msg of messages) {
    if (msg.role === "user") {
      const content = msg.content;
      if (typeof content === "string") {
        const trimmedContent = content.trim();
        const urlMatches = trimmedContent.match(/https?:\/\/\S+/gi) ?? [];
        // Check for image URLs in text content
        return (
          /\bdata:image\//i.test(trimmedContent) ||
          urlMatches.some(url => /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url))
        );
      }
      // Check for image content parts in array format
      if (Array.isArray(content)) {
        return content.some(
          part =>
            part.type === "image" ||
            part.type === "image_url" ||
            (part.type === "file" &&
              typeof part.mediaType === "string" &&
              part.mediaType.startsWith("image/"))
        );
      }
    }
  }
  return false;
}
