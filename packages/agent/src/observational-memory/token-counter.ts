import { AsyncLocalStorage } from "node:async_hooks";
import imageSize from "image-size";
import { estimateTokenCount } from "tokenx";

import type { AgentMessage } from "../types.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TokenCounterModelContext = {
  provider?: string | undefined;
  modelId?: string | undefined;
};

type TokenCounterOptions = {
  model?: string | TokenCounterModelContext;
};

type ImageTokenDetail = "low" | "high" | "auto";

type ImageTokenEstimatorConfig = {
  baseTokens: number;
  tileTokens: number;
  fallbackTiles: number;
};

type GoogleMediaResolution = "low" | "medium" | "high" | "ultra_high" | "unspecified";

type ImageTokenEstimate = {
  tokens: number;
  cachePayload: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_IMAGE_ESTIMATOR: ImageTokenEstimatorConfig = {
  baseTokens: 85,
  tileTokens: 170,
  fallbackTiles: 4,
};

const GOOGLE_LEGACY_IMAGE_TOKENS_PER_TILE = 258;
const GOOGLE_GEMINI_3_IMAGE_TOKENS_BY_RESOLUTION: Record<GoogleMediaResolution, number> = {
  low: 280,
  medium: 560,
  high: 1120,
  ultra_high: 2240,
  unspecified: 1120,
};

const ANTHROPIC_IMAGE_TOKENS_PER_PIXEL = 1 / 750;
const ANTHROPIC_IMAGE_MAX_LONG_EDGE = 1568;

const GOOGLE_MEDIA_RESOLUTION_VALUES = new Set<GoogleMediaResolution>([
  "low",
  "medium",
  "high",
  "ultra_high",
  "unspecified",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getObjectValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isHttpUrlString(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isLikelyBase64Content(value: string): boolean {
  if (value.length < 16 || value.length % 4 !== 0 || /\s/.test(value)) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function decodeImageBuffer(value: unknown): Buffer | undefined {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);

  if (typeof value !== "string" || isHttpUrlString(value)) return undefined;

  if (value.startsWith("data:")) {
    const commaIndex = value.indexOf(",");
    if (commaIndex === -1) return undefined;
    const header = value.slice(0, commaIndex);
    const payload = value.slice(commaIndex + 1);
    if (/;base64/i.test(header)) return Buffer.from(payload, "base64");
    return Buffer.from(decodeURIComponent(payload), "utf8");
  }

  if (!isLikelyBase64Content(value)) return undefined;
  return Buffer.from(value, "base64");
}

function normalizeImageDetail(detail: unknown): ImageTokenDetail {
  if (detail === "low" || detail === "high") return detail;
  return "auto";
}

function resolveImageDetail(part: Record<string, unknown>): ImageTokenDetail {
  const providerOptions = getObjectValue(getObjectValue(part, "providerOptions"), "openai");
  const providerMetadata = getObjectValue(getObjectValue(part, "providerMetadata"), "openai");
  return normalizeImageDetail(
    getObjectValue(part, "detail") ??
      getObjectValue(part, "imageDetail") ??
      getObjectValue(providerOptions, "detail") ??
      getObjectValue(providerOptions, "imageDetail") ??
      getObjectValue(providerMetadata, "detail") ??
      getObjectValue(providerMetadata, "imageDetail"),
  );
}

function normalizeGoogleMediaResolution(value: unknown): GoogleMediaResolution | undefined {
  return typeof value === "string" &&
    GOOGLE_MEDIA_RESOLUTION_VALUES.has(value as GoogleMediaResolution)
    ? (value as GoogleMediaResolution)
    : undefined;
}

function resolveGoogleMediaResolution(part: Record<string, unknown>): GoogleMediaResolution {
  const providerOptions = getObjectValue(getObjectValue(part, "providerOptions"), "google");
  const providerMetadata = getObjectValue(getObjectValue(part, "providerMetadata"), "google");
  return (
    normalizeGoogleMediaResolution(getObjectValue(part, "mediaResolution")) ??
    normalizeGoogleMediaResolution(getObjectValue(providerOptions, "mediaResolution")) ??
    normalizeGoogleMediaResolution(getObjectValue(providerMetadata, "mediaResolution")) ??
    "unspecified"
  );
}

function resolveProviderId(modelContext?: TokenCounterModelContext): string | undefined {
  return modelContext?.provider?.toLowerCase();
}

function resolveModelId(modelContext?: TokenCounterModelContext): string {
  return modelContext?.modelId?.toLowerCase() ?? "";
}

function parseModelContext(
  model?: string | TokenCounterModelContext,
): TokenCounterModelContext | undefined {
  if (!model) return undefined;
  if (typeof model === "object") {
    return model.provider || model.modelId
      ? {
          ...(model.provider !== undefined ? { provider: model.provider } : {}),
          ...(model.modelId !== undefined ? { modelId: model.modelId } : {}),
        }
      : undefined;
  }
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) return { modelId: model };
  return { provider: model.slice(0, slashIndex), modelId: model.slice(slashIndex + 1) };
}

// ─── Image dimension resolution ──────────────────────────────────────────────

function resolveImageDimensions(part: Record<string, unknown>): {
  width?: number;
  height?: number;
} {
  const width =
    getFiniteNumber(getObjectValue(part, "width")) ??
    getFiniteNumber(getObjectValue(part, "imageWidth"));
  const height =
    getFiniteNumber(getObjectValue(part, "height")) ??
    getFiniteNumber(getObjectValue(part, "imageHeight"));

  if (width && height) return { width, height };

  const asset = getObjectValue(part, "image") ?? getObjectValue(part, "data");
  const buffer = decodeImageBuffer(asset);
  if (!buffer)
    return {
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    };

  try {
    const measured = imageSize(buffer);
    const measuredWidth = getFiniteNumber(measured.width);
    const measuredHeight = getFiniteNumber(measured.height);
    if (!measuredWidth || !measuredHeight)
      return {
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      };
    return { width: width ?? measuredWidth, height: height ?? measuredHeight };
  } catch {
    return {
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    };
  }
}

function resolveImageSourceStats(image: unknown): {
  source: "url" | "data-uri" | "binary";
  sizeBytes?: number;
} {
  if (image instanceof URL) return { source: "url" };

  if (typeof image === "string") {
    if (isHttpUrlString(image)) return { source: "url" };
    if (image.startsWith("data:")) {
      const commaIndex = image.indexOf(",");
      const encoded = commaIndex === -1 ? "" : image.slice(commaIndex + 1);
      const sanitized = encoded.replace(/\s+/g, "");
      const padding = sanitized.endsWith("==") ? 2 : sanitized.endsWith("=") ? 1 : 0;
      return {
        source: "data-uri",
        sizeBytes: Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding),
      };
    }
    const sanitized = image.replace(/\s+/g, "");
    const padding = sanitized.endsWith("==") ? 2 : sanitized.endsWith("=") ? 1 : 0;
    return {
      source: "binary",
      sizeBytes: Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding),
    };
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(image))
    return { source: "binary", sizeBytes: image.length };
  if (image instanceof Uint8Array) return { source: "binary", sizeBytes: image.byteLength };
  if (image instanceof ArrayBuffer) return { source: "binary", sizeBytes: image.byteLength };
  if (ArrayBuffer.isView(image)) return { source: "binary", sizeBytes: image.byteLength };

  return { source: "binary" };
}

// ─── Image token estimation ──────────────────────────────────────────────────

function isGoogleGemini3Model(modelContext?: TokenCounterModelContext): boolean {
  return (
    resolveProviderId(modelContext) === "google" &&
    resolveModelId(modelContext).startsWith("gemini-3")
  );
}

function scaleDimensionsForOpenAIHighDetail(
  width: number,
  height: number,
): { width: number; height: number } {
  let scaledWidth = width;
  let scaledHeight = height;
  const largestSide = Math.max(scaledWidth, scaledHeight);
  if (largestSide > 2048) {
    const ratio = 2048 / largestSide;
    scaledWidth *= ratio;
    scaledHeight *= ratio;
  }
  const shortestSide = Math.min(scaledWidth, scaledHeight);
  if (shortestSide > 768) {
    const ratio = 768 / shortestSide;
    scaledWidth *= ratio;
    scaledHeight *= ratio;
  }
  return {
    width: Math.max(1, Math.round(scaledWidth)),
    height: Math.max(1, Math.round(scaledHeight)),
  };
}

function scaleDimensionsForAnthropic(
  width: number,
  height: number,
): { width: number; height: number } {
  const largestSide = Math.max(width, height);
  if (largestSide <= ANTHROPIC_IMAGE_MAX_LONG_EDGE) return { width, height };
  const ratio = ANTHROPIC_IMAGE_MAX_LONG_EDGE / largestSide;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function resolveOpenAIImageEstimatorConfig(
  modelContext?: TokenCounterModelContext,
): ImageTokenEstimatorConfig {
  const modelId = resolveModelId(modelContext);
  if (modelId.startsWith("gpt-5") || modelId === "gpt-5-chat-latest")
    return { baseTokens: 70, tileTokens: 140, fallbackTiles: 4 };
  if (modelId.startsWith("gpt-4o-mini"))
    return { baseTokens: 2833, tileTokens: 5667, fallbackTiles: 1 };
  if (modelId.startsWith("o1") || modelId.startsWith("o3"))
    return { baseTokens: 75, tileTokens: 150, fallbackTiles: 4 };
  if (modelId.includes("computer-use"))
    return { baseTokens: 65, tileTokens: 129, fallbackTiles: 4 };
  return DEFAULT_IMAGE_ESTIMATOR;
}

function estimateOpenAIHighDetailTiles(
  dimensions: { width?: number; height?: number },
  sourceStats: { sizeBytes?: number },
  estimator: ImageTokenEstimatorConfig,
): number {
  if (dimensions.width && dimensions.height) {
    const scaled = scaleDimensionsForOpenAIHighDetail(dimensions.width, dimensions.height);
    return Math.max(1, Math.ceil(scaled.width / 512) * Math.ceil(scaled.height / 512));
  }
  if (sourceStats.sizeBytes !== undefined) {
    if (sourceStats.sizeBytes <= 512 * 1024) return 1;
    if (sourceStats.sizeBytes <= 2 * 1024 * 1024) return 4;
    if (sourceStats.sizeBytes <= 4 * 1024 * 1024) return 6;
    return 8;
  }
  return estimator.fallbackTiles;
}

function resolveEffectiveOpenAIImageDetail(
  detail: ImageTokenDetail,
  dimensions: { width?: number; height?: number },
  sourceStats: { sizeBytes?: number },
): Exclude<ImageTokenDetail, "auto"> {
  if (detail === "low" || detail === "high") return detail;
  if (dimensions.width && dimensions.height)
    return Math.max(dimensions.width, dimensions.height) > 768 ? "high" : "low";
  if (sourceStats.sizeBytes !== undefined)
    return sourceStats.sizeBytes > 1024 * 1024 ? "high" : "low";
  return "low";
}

function estimateLegacyGoogleImageTiles(dimensions: { width?: number; height?: number }): number {
  if (!dimensions.width || !dimensions.height) return 1;
  return Math.max(1, Math.ceil(dimensions.width / 768) * Math.ceil(dimensions.height / 768));
}

function estimateGoogleImageTokens(
  modelContext: TokenCounterModelContext | undefined,
  part: Record<string, unknown>,
  dimensions: { width?: number; height?: number },
): { tokens: number; mediaResolution: GoogleMediaResolution } {
  if (isGoogleGemini3Model(modelContext)) {
    const mediaResolution = resolveGoogleMediaResolution(part);
    return { tokens: GOOGLE_GEMINI_3_IMAGE_TOKENS_BY_RESOLUTION[mediaResolution], mediaResolution };
  }
  return {
    tokens: estimateLegacyGoogleImageTiles(dimensions) * GOOGLE_LEGACY_IMAGE_TOKENS_PER_TILE,
    mediaResolution: "unspecified",
  };
}

function estimateAnthropicImageTokens(
  dimensions: { width?: number; height?: number },
  sourceStats: { sizeBytes?: number },
): number {
  if (dimensions.width && dimensions.height) {
    const scaled = scaleDimensionsForAnthropic(dimensions.width, dimensions.height);
    return Math.max(1, Math.ceil(scaled.width * scaled.height * ANTHROPIC_IMAGE_TOKENS_PER_PIXEL));
  }
  if (sourceStats.sizeBytes !== undefined) {
    if (sourceStats.sizeBytes <= 512 * 1024) return 341;
    if (sourceStats.sizeBytes <= 2 * 1024 * 1024) return 1366;
    if (sourceStats.sizeBytes <= 4 * 1024 * 1024) return 2048;
    return 2731;
  }
  return 1600;
}

function estimateImageTokens(
  modelContext: TokenCounterModelContext | undefined,
  part: Record<string, unknown>,
): ImageTokenEstimate {
  const provider = resolveProviderId(modelContext);
  const modelId = modelContext?.modelId ?? null;
  const detail = resolveImageDetail(part);
  const dimensions = resolveImageDimensions(part);
  const asset = getObjectValue(part, "image") ?? getObjectValue(part, "data");
  const sourceStats = resolveImageSourceStats(asset);

  if (provider === "google") {
    const googleEstimate = estimateGoogleImageTokens(modelContext, part, dimensions);
    return {
      tokens: googleEstimate.tokens,
      cachePayload: JSON.stringify({
        kind: "image",
        provider,
        modelId,
        estimator: isGoogleGemini3Model(modelContext) ? "google-gemini-3" : "google-legacy",
        mediaResolution: googleEstimate.mediaResolution,
        width: dimensions.width ?? null,
        height: dimensions.height ?? null,
        source: sourceStats.source,
        sizeBytes: sourceStats.sizeBytes ?? null,
      }),
    };
  }

  if (provider === "anthropic") {
    return {
      tokens: estimateAnthropicImageTokens(dimensions, sourceStats),
      cachePayload: JSON.stringify({
        kind: "image",
        provider,
        modelId,
        estimator: "anthropic",
        width: dimensions.width ?? null,
        height: dimensions.height ?? null,
        source: sourceStats.source,
        sizeBytes: sourceStats.sizeBytes ?? null,
      }),
    };
  }

  const estimator = resolveOpenAIImageEstimatorConfig(modelContext);
  const effectiveDetail = resolveEffectiveOpenAIImageDetail(detail, dimensions, sourceStats);
  const tiles =
    effectiveDetail === "high"
      ? estimateOpenAIHighDetailTiles(dimensions, sourceStats, estimator)
      : 0;
  const tokens = estimator.baseTokens + tiles * estimator.tileTokens;

  return {
    tokens,
    cachePayload: JSON.stringify({
      kind: "image",
      provider,
      modelId,
      estimator: provider === "openai" ? "openai" : "fallback",
      detail,
      effectiveDetail,
      width: dimensions.width ?? null,
      height: dimensions.height ?? null,
      source: sourceStats.source,
      sizeBytes: sourceStats.sizeBytes ?? null,
    }),
  };
}

function estimateNonImageFileTokens(
  modelContext: TokenCounterModelContext | undefined,
  part: Record<string, unknown>,
): { tokens: number; cachePayload: string } | undefined {
  const asset = getObjectValue(part, "data") ?? getObjectValue(part, "image");
  const sourceStats = resolveImageSourceStats(asset);
  if (sourceStats.sizeBytes === undefined) return undefined;

  const provider = resolveProviderId(modelContext);
  const mimeType = (getObjectValue(part, "mimeType") as string) ?? "application/octet-stream";
  const normalizedMime = mimeType.toLowerCase().split(";", 1)[0]!.trim();
  const isPdf = normalizedMime === "application/pdf";

  let tokens: number;
  if (isPdf) {
    if (provider === "google") tokens = Math.max(258, Math.ceil(sourceStats.sizeBytes / 20));
    else if (provider === "anthropic")
      tokens = Math.max(1500, Math.ceil(sourceStats.sizeBytes / 3));
    else tokens = Math.max(500, Math.ceil(sourceStats.sizeBytes / 4));
  } else {
    tokens = Math.max(1, Math.ceil(sourceStats.sizeBytes / 4));
  }

  return {
    tokens,
    cachePayload: JSON.stringify({
      kind: "non-image-file",
      provider: provider ?? "fallback",
      modelId: modelContext?.modelId ?? null,
      estimator: "bytes",
      source: sourceStats.source,
      sizeBytes: sourceStats.sizeBytes,
      mimeType: normalizedMime,
    }),
  };
}

function isImageLikeFilePart(part: Record<string, unknown>): boolean {
  if (getObjectValue(part, "type") !== "file") return false;
  const mimeType = getObjectValue(part, "mimeType");
  if (typeof mimeType === "string" && mimeType.toLowerCase().startsWith("image/")) return true;
  const data = getObjectValue(part, "data");
  if (typeof data === "string" && data.startsWith("data:image/")) return true;
  return false;
}

// ─── Part estimation ─────────────────────────────────────────────────────────

function countAttachmentPartSync(
  modelContext: TokenCounterModelContext | undefined,
  part: Record<string, unknown>,
): number | undefined {
  const partType = getObjectValue(part, "type");

  if (partType === "image") {
    return estimateImageTokens(modelContext, part).tokens;
  }

  if (partType === "file" && isImageLikeFilePart(part)) {
    return estimateImageTokens(modelContext, part).tokens;
  }

  if (partType === "file") {
    const byteEstimate = estimateNonImageFileTokens(modelContext, part);
    if (byteEstimate) return byteEstimate.tokens;
    return undefined;
  }

  return undefined;
}

function countStringTokens(text: string): number {
  if (!text) return 0;
  return estimateTokenCount(text);
}

// ─── TokenCounter ────────────────────────────────────────────────────────────

/**
 * Token counting utility using tokenx for rough local estimation and
 * provider-aware heuristics for image parts so multimodal prompts are not
 * undercounted as generic JSON blobs.
 *
 * Ported from Mastra's token-counter.ts for sakti's AgentMessage types.
 */
export class TokenCounter {
  private readonly defaultModelContext: TokenCounterModelContext | undefined;
  private readonly modelContextStorage = new AsyncLocalStorage<
    TokenCounterModelContext | undefined
  >();

  // Per-message overhead: accounts for role tokens, message framing, and separators.
  private static readonly TOKENS_PER_MESSAGE = 3.8;
  // Conversation-level overhead: system prompt framing, reply priming tokens, etc.
  private static readonly TOKENS_PER_CONVERSATION = 24;

  constructor(options?: TokenCounterOptions) {
    this.defaultModelContext = parseModelContext(options?.model);
  }

  runWithModelContext<T>(model: string | TokenCounterModelContext | undefined, fn: () => T): T {
    return this.modelContextStorage.run(parseModelContext(model), fn);
  }

  private getModelContext(): TokenCounterModelContext | undefined {
    return this.modelContextStorage.getStore() ?? this.defaultModelContext;
  }

  /**
   * Count tokens in a plain string.
   */
  countString(text: string): number {
    return countStringTokens(text);
  }

  /**
   * Count tokens in a single AgentMessage.
   *
   * Handles the sakti message union: UserMessage, AssistantMessage,
   * ToolResultMessage, CustomMessage, BashExecutionMessage,
   * BranchSummaryMessage, CompactionSummaryMessage.
   */
  countMessage(message: AgentMessage): number {
    const modelContext = this.getModelContext();
    let payloadTokens = 0;
    let overhead = TokenCounter.TOKENS_PER_MESSAGE;

    switch (message.role) {
      case "user": {
        payloadTokens += countStringTokens(message.role);
        if (typeof message.content === "string") {
          payloadTokens += countStringTokens(message.content);
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === "text") {
              payloadTokens += countStringTokens(part.text);
            } else if (part.type === "image") {
              const estimate = estimateImageTokens(
                modelContext,
                part as unknown as Record<string, unknown>,
              );
              payloadTokens += estimate.tokens;
            }
          }
        }
        break;
      }

      case "assistant": {
        payloadTokens += countStringTokens(message.role);
        for (const block of message.content) {
          if (block.type === "text") {
            payloadTokens += countStringTokens(block.text);
          } else if (block.type === "thinking") {
            payloadTokens += countStringTokens(block.thinking);
          } else if (block.type === "toolCall") {
            payloadTokens += countStringTokens(block.name);
            const argsJson = JSON.stringify(block.arguments);
            payloadTokens += countStringTokens(argsJson);
            overhead -= 12; // JSON args have less framing overhead
          }
        }
        break;
      }

      case "toolResult": {
        payloadTokens += countStringTokens(message.role);
        payloadTokens += countStringTokens(message.toolName);
        overhead += TokenCounter.TOKENS_PER_MESSAGE; // extra overhead for tool result
        for (const part of message.content) {
          if (part.type === "text") {
            payloadTokens += countStringTokens(part.text);
          } else if (part.type === "image") {
            const attachmentTokens = countAttachmentPartSync(
              modelContext,
              part as unknown as Record<string, unknown>,
            );
            payloadTokens +=
              attachmentTokens ??
              estimateImageTokens(modelContext, part as unknown as Record<string, unknown>).tokens;
          }
        }
        break;
      }

      case "custom": {
        payloadTokens += countStringTokens(message.role);
        if (typeof message.content === "string") {
          payloadTokens += countStringTokens(message.content);
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === "text") {
              payloadTokens += countStringTokens(part.text);
            } else if (part.type === "image") {
              const estimate = estimateImageTokens(
                modelContext,
                part as unknown as Record<string, unknown>,
              );
              payloadTokens += estimate.tokens;
            }
          }
        }
        break;
      }

      case "bashExecution": {
        payloadTokens += countStringTokens(message.role);
        payloadTokens += countStringTokens(message.command);
        payloadTokens += countStringTokens(message.output);
        break;
      }

      case "branchSummary": {
        payloadTokens += countStringTokens(message.role);
        payloadTokens += countStringTokens(message.summary);
        break;
      }

      case "compactionSummary": {
        payloadTokens += countStringTokens(message.role);
        payloadTokens += countStringTokens(message.summary);
        break;
      }
    }

    return Math.round(payloadTokens + overhead);
  }

  /**
   * Count tokens in an array of messages.
   */
  countMessages(messages: AgentMessage[]): number {
    if (!messages || messages.length === 0) return 0;
    let total = TokenCounter.TOKENS_PER_CONVERSATION;
    for (const message of messages) {
      total += this.countMessage(message);
    }
    return total;
  }

  /**
   * Count tokens in observations string (sync).
   */
  countObservations(observations: string): number {
    return this.countString(observations);
  }
}
