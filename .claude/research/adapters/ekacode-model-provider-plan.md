# Ekacode Model Provider Integration Plan

## Executive Summary

This document outlines the integration strategy for using **@tanstack/ai** with **Mastra** to support the **models.dev registry**. The key insight is that **Mastra already has models.dev integration** through its gateway system, so we need to create a **TanStack AI adapter** that leverages Mastra's existing `ModelRouterLanguageModel`.

---

## Architecture Overview

### Current State: Mastra Already Has models.dev Support

Mastra's LLM system includes a complete gateway architecture with models.dev integration:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Mastra Gateway System                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    MastraModelGateway (Abstract)                        ││
│  │  ├─ fetchProviders(): Promise<Record<string, ProviderConfig>>          ││
│  │  ├─ buildUrl(modelId): string | undefined                              ││
│  │  ├─ getApiKey(modelId): Promise<string>                                ││
│  │  └─ resolveLanguageModel(...): Promise<GatewayLanguageModel>            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    ▲                                        │
│                    ┌───────────────────┴───────────────────┐                 │
│                    │                                       │                 │
│           ┌────────┴────────┐                    ┌───────┴────────┐         │
│           │ ModelsDevGateway │                    │  NetlifyGateway │         │
│           │                  │                    │                 │         │
│           │ - Fetches from   │                    │ - Netlify AI    │         │
│           │   models.dev/api │                    │   Gateway       │         │
│           │   .json         │                    │                 │         │
│           └─────────────────┘                    └─────────────────┘         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                   GatewayRegistry (Singleton)                          ││
│  │  ├─ syncGateways(): Fetch from all gateways                         ││
│  │  ├─ startAutoRefresh(): Hourly refresh                              ││
│  │  └─ getProviders(): Record<string, ProviderConfig>                   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                 ModelRouterLanguageModel                               ││
│  │  ├─ Resolves gateway for model ID                                     ││
│  │  ├─ Delegates to gateway.resolveLanguageModel()                      ││
│  │  └─ Implements MastraLanguageModelV2 interface                       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### TanStack AI Adapter Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TanStack AI Adapter System                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    BaseTextAdapter<TModel, ...>                          ││
│  │  ├─ kind: 'text'                                                        ││
│  │  ├─ name: string                                                        ││
│  │  ├─ model: TModel                                                       ││
│  │  ├─ ~types: { providerOptions, inputModalities, ... }                   ││
│  │  ├─ chatStream(options): AsyncIterable<StreamChunk>                    ││
│  │  └─ structuredOutput(options): Promise<StructuredOutputResult>         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    ▲                                        │
│                    ┌───────────────────┴───────────────────┐                 │
│                    │                                       │                 │
│     ┌──────────────┴──────────┐               ┌────────┴────────┐         │
│     │   OpenAITextAdapter      │               │ AnthropicAdapter │         │
│     │   GeminiTextAdapter     │               │  OllamaAdapter   │         │
│     │   GrokTextAdapter       │               │  (etc...)        │         │
│     └─────────────────────────┘               └─────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Integration Strategy: Create TanStack AI Adapter for Mastra

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Integration: TanStack AI ↔ Mastra                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                  @tanstack-ai-mastra (New Package)                      ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  │               MastraTextAdapter                                    ││
│  │  │  Extends BaseTextAdapter, wraps ModelRouterLanguageModel          ││
│  │  └─────────────────────────────────────────────────────────────────────┘│
│  │                              │                                         │
│  │                              ▼                                         │
│  │  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  │              mastraText(modelId: string)                           ││
│  │  │  Factory function that creates MastraTextAdapter                  ││
│  │  └─────────────────────────────────────────────────────────────────────┘│
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                     @mastra/core LLM System                           ││
│  │  ├─ GatewayRegistry with models.dev integration                      ││
│  │  ├─ ModelRouterLanguageModel                                          ││
│  │  └─ MastraModelGateway implementations                                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Mastra's Gateway System Analysis

### Gateway Base Interface

**File:** `/mastra/packages/core/src/llm/model/gateways/base.ts`

```typescript
export interface ProviderConfig {
  url?: string;
  apiKeyHeader?: string;
  apiKeyEnvVar: string | string[];
  name: string;
  models: string[];
  docUrl?: string;
  gateway: string;
}

export abstract class MastraModelGateway {
  abstract readonly id: string;
  abstract readonly name: string;

  // Fetch provider configurations from the gateway
  abstract fetchProviders(): Promise<Record<string, ProviderConfig>>;

  // Build URL for a specific model
  abstract buildUrl(modelId: string, envVars: Record<string, string>): string | undefined;

  // Get API key from environment
  abstract getApiKey(modelId: string): Promise<string>;

  // Resolve to AI SDK language model (V2 or V3)
  abstract resolveLanguageModel(args: {
    modelId: string;
    providerId: string;
    apiKey: string;
    headers?: Record<string, string>;
  }): Promise<GatewayLanguageModel | GatewayLanguageModel>;
}
```

### ModelsDevGateway Implementation

**File:** `/mastra/packages/core/src/llm/model/gateways/models-dev.ts`

```typescript
export class ModelsDevGateway extends MastraModelGateway {
  readonly id = "models.dev";
  readonly name = "models.dev";

  private providerConfigs: Record<string, ProviderConfig> = {};

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    const response = await fetch("https://models.dev/api.json");
    const data = (await response.json()) as ModelsDevResponse;

    const providerConfigs: Record<string, ProviderConfig> = {};

    for (const [providerId, providerInfo] of Object.entries(data)) {
      // Skip excluded providers
      if (EXCLUDED_PROVIDERS.includes(providerId)) continue;

      // Check if OpenAI-compatible
      const isOpenAICompatible =
        providerInfo.npm === "@ai-sdk/openai-compatible" ||
        providerInfo.npm === "@ai-sdk/gateway" ||
        providerId in OPENAI_COMPATIBLE_OVERRIDES;

      const hasInstalledPackage = PROVIDERS_WITH_INSTALLED_PACKAGES.includes(providerId);
      const hasApiAndEnv = providerInfo.api && providerInfo.env?.length > 0;

      if (isOpenAICompatible || hasInstalledPackage || hasApiAndEnv) {
        // Filter out deprecated models
        const modelIds = Object.entries(providerInfo.models)
          .filter(([, modelInfo]) => modelInfo?.status !== "deprecated")
          .map(([modelId]) => modelId)
          .sort();

        providerConfigs[providerId] = {
          url: providerInfo.api || OPENAI_COMPATIBLE_OVERRIDES[providerId]?.url,
          apiKeyEnvVar:
            providerInfo.env?.[0] || `${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`,
          apiKeyHeader: isOpenAICompatible ? "Authorization" : undefined,
          name: providerInfo.name || providerId,
          models: modelIds,
          docUrl: providerInfo.doc,
          gateway: "models.dev",
        };
      }
    }

    this.providerConfigs = providerConfigs;
    return providerConfigs;
  }

  async resolveLanguageModel({ modelId, providerId, apiKey, headers }): Promise<LanguageModelV2> {
    switch (providerId) {
      case "openai":
        return createOpenAI({ apiKey }).responses(modelId);
      case "anthropic":
        return createAnthropic({ apiKey })(modelId);
      case "google":
      case "gemini":
        return createGoogleGenerativeAI({ apiKey }).chat(modelId);
      // ... more providers
      default:
        // OpenAI-compatible fallback
        const baseURL = this.buildUrl(`${providerId}/${modelId}`);
        return createOpenAICompatible({
          name: providerId,
          apiKey,
          baseURL,
          supportsStructuredOutputs: true,
        }).chatModel(modelId);
    }
  }
}
```

### Gateway Registry with Auto-Refresh

**File:** `/mastra/packages/core/src/llm/model/provider-registry.ts`

```typescript
export class GatewayRegistry {
  private static instance: GatewayRegistry | null = null;
  private lastRefreshTime: Date | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private useDynamicLoading: boolean;

  async syncGateways(forceRefresh = false): Promise<void> {
    const { ModelsDevGateway } = await import("./gateways/models-dev.js");
    const { NetlifyGateway } = await import("./gateways/netlify.js");

    const defaultGateways = [new ModelsDevGateway({}), new NetlifyGateway()];

    const { fetchProvidersFromGateways, writeRegistryFiles } =
      await import("./registry-generator.js");

    // Fetch from all gateways
    const { providers, models } = await fetchProvidersFromGateways(defaultGateways);

    // Write to global cache: ~/.cache/mastra/provider-registry.json
    // Write to dist: dist/provider-registry.json
    await writeRegistryFiles(
      GLOBAL_PROVIDER_REGISTRY_JSON(),
      GLOBAL_PROVIDER_TYPES_DTS(),
      providers,
      models
    );

    this.lastRefreshTime = new Date();
  }

  startAutoRefresh(intervalMs = 60 * 60 * 1000): void {
    // Check if immediate sync needed
    const lastRefresh = getLastRefreshTimeFromDisk();
    const shouldRefresh = !lastRefresh || Date.now() - lastRefresh.getTime() > intervalMs;

    if (shouldRefresh) {
      this.syncGateways();
    }

    // Set up hourly refresh
    this.refreshInterval = setInterval(() => {
      this.syncGateways();
    }, intervalMs);

    this.refreshInterval.unref(); // Don't keep process alive
  }
}
```

### Model Router Language Model

**File:** `/mastra/packages/core/src/llm/model/router.ts`

```typescript
export class ModelRouterLanguageModel implements MastraLanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly modelId: string;
  readonly provider: string;

  private config: OpenAICompatibleConfig & { routerId: string };
  private gateway: MastraModelGateway;

  constructor(config: ModelRouterModelId | OpenAICompatibleConfig, customGateways?: MastraModelGateway[]) {
    // Normalize config to { id: 'provider/model', url?, apiKey?, headers? }
    const normalizedConfig = /* ... normalization logic ... */;

    // Resolve gateway for this model ID
    this.gateway = findGatewayForModel(normalizedConfig.id, [
      ...(customGateways || []),
      ...defaultGateways, // [ModelsDevGateway, NetlifyGateway]
    ]);

    const gatewayPrefix = this.gateway.id === 'models.dev' ? undefined : this.gateway.id;
    const parsed = parseModelRouterId(normalizedConfig.id, gatewayPrefix);

    this.provider = parsed.providerId || 'openai-compatible';
    this.modelId = parsed.modelId;
    this.config = normalizedConfig;
  }

  async doGenerate(options: LanguageModelV2CallOptions): Promise<StreamResult> {
    const apiKey = this.config.apiKey || await this.gateway.getApiKey(this.config.routerId);
    const model = await this.resolveLanguageModel({ apiKey, /* ... */ });

    // Handle both AI SDK v5 (V2) and v6 (V3)
    if (isLanguageModelV3(model)) {
      return new AISDKV6LanguageModel(model).doGenerate(options);
    }
    return new AISDKV5LanguageModel(model).doGenerate(options);
  }

  private async resolveLanguageModel({ modelId, providerId, apiKey, headers }) {
    // Check cache first
    const key = createHash('sha256')
      .update(this.gateway.id + modelId + providerId + apiKey + /* ... */)
      .digest('hex');

    if (ModelRouterLanguageModel.modelInstances.has(key)) {
      return ModelRouterLanguageModel.modelInstances.get(key);
    }

    const modelInstance = await this.gateway.resolveLanguageModel({
      modelId,
      providerId,
      apiKey,
      headers,
    });

    ModelRouterLanguageModel.modelInstances.set(key, modelInstance);
    return modelInstance;
  }
}
```

---

## TanStack AI Adapter Pattern

### Base Text Adapter Interface

**File:** `/tanstack-ai/packages/typescript/ai/src/activities/chat/adapter.ts`

```typescript
export interface TextAdapter<
  TModel extends string,
  TProviderOptions extends Record<string, any>,
  TInputModalities extends ReadonlyArray<Modality>,
  TMessageMetadataByModality extends DefaultMessageMetadataByModality,
> {
  readonly kind: "text";
  readonly name: string;
  readonly model: TModel;

  /**
   * @internal Type-only properties for inference. Not assigned at runtime.
   */
  "~types": {
    providerOptions: TProviderOptions;
    inputModalities: TInputModalities;
    messageMetadataByModality: TMessageMetadataByModality;
  };

  chatStream: (options: TextOptions<TProviderOptions>) => AsyncIterable<StreamChunk>;

  structuredOutput: (
    options: StructuredOutputOptions<TProviderOptions>
  ) => Promise<StructuredOutputResult<unknown>>;
}

export abstract class BaseTextAdapter<
  TModel extends string,
  TProviderOptions extends Record<string, any>,
  TInputModalities extends ReadonlyArray<Modality>,
  TMessageMetadataByModality extends DefaultMessageMetadataByModality,
> implements TextAdapter<TModel, TProviderOptions, TInputModalities, TMessageMetadataByModality> {
  readonly kind = "text" as const;
  abstract readonly name: string;
  readonly model: TModel;

  declare "~types": {
    providerOptions: TProviderOptions;
    inputModalities: TInputModalities;
    messageMetadataByModality: TMessageMetadataByModality;
  };

  protected config: TextAdapterConfig;

  constructor(config: TextAdapterConfig = {}, model: TModel) {
    this.config = config;
    this.model = model;
  }

  abstract chatStream(options: TextOptions<TProviderOptions>): AsyncIterable<StreamChunk>;
  abstract structuredOutput(
    options: StructuredOutputOptions<TProviderOptions>
  ): Promise<StructuredOutputResult<unknown>>;
}
```

### OpenAI Text Adapter Example

**File:** `/tanstack-ai/packages/typescript/ai-openai/src/adapters/text.ts`

```typescript
import { BaseTextAdapter } from "@tanstack/ai/adapters";
import { openai } from "@ai-sdk/openai";

export class OpenAITextAdapter extends BaseTextAdapter<
  OpenAIChatModel,
  OpenAITextProviderOptions,
  typeof OPENAI_INPUT_MODALITIES,
  typeof OPENAI_METADATA_BY_MODALITY
> {
  readonly kind = "text" as const;
  readonly name = "openai" as const;

  async *chatStream(options: TextOptions<OpenAITextProviderOptions>): AsyncIterable<StreamChunk> {
    const { messages, tools, temperature, maxTokens, ...rest } = options;

    const stream = await openai(this.config.apiKey || process.env.OPENAI_API_KEY)
      .chat(this.model)
      .doStream({
        messages,
        tools: tools ? convertTools(tools) : undefined,
        temperature,
        maxTokens,
        ...rest,
      });

    // Transform AI SDK stream to TanStack StreamChunk format
    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case "text-delta":
        case "tool-call":
        case "tool-result":
          yield transformToStreamChunk(chunk);
      }
    }
  }

  async structuredOutput(
    options: StructuredOutputOptions<OpenAITextProviderOptions>
  ): Promise<StructuredOutputResult> {
    const { chatOptions, outputSchema } = options;

    const { object } = await generateObject({
      model: openai(this.config.apiKey || process.env.OPENAI_API_KEY).chat(this.model),
      schema: outputSchema,
      messages: chatOptions.messages,
      ...chatOptions,
    });

    return {
      data: object,
      rawText: JSON.stringify(object),
    };
  }
}

export function createOpenaiChat<TModel extends OpenAIChatModel>(
  model: TModel,
  apiKey?: string
): OpenAITextAdapter {
  return new OpenAITextAdapter({ apiKey }, model);
}

export function openaiText<TModel extends OpenAIChatModel>(
  model: TModel,
  config?: Omit<OpenAITextConfig, "model">
): OpenAITextAdapter {
  const adapter = new OpenAITextAdapter(
    {
      apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
      ...config,
    },
    model
  );
  return adapter as OpenAITextAdapter;
}
```

### TanStack AI Chat Function

**File:** `/tanstack-ai/packages/typescript/ai/src/activities/chat/index.ts`

```typescript
export async function chat<TAdapter extends AnyTextAdapter>(
  adapter: TAdapter,
  options: ChatOptions<TAdapter>
): Promise<ChatResult<TAdapter>> {
  const { messages, tools, onChunk, ...rest } = options;

  const chunks: StreamChunk[] = [];
  const toolCalls: ToolCall[] = [];

  // Stream from adapter
  for await (const chunk of adapter.chatStream({
    messages,
    tools,
    ...rest,
  })) {
    chunks.push(chunk);

    // Handle different chunk types
    switch (chunk.type) {
      case "text-delta":
        onChunk?.(chunk);
        break;
      case "tool-call":
        toolCalls.push(chunk);
        // Execute tool and continue
        break;
    }
  }

  return {
    text: chunks.map(c => (c.type === "text-delta" ? c.text : "")).join(""),
    toolCalls,
    usage: calculateUsage(chunks),
  };
}
```

---

## Integration Plan: @tanstack-ai-mastra Package

### Package Structure

```
@tanstack-ai-mastra/
├── package.json
├── src/
│   ├── index.ts              # Main exports
│   ├── adapters/
│   │   └── text.ts           # MastraTextAdapter implementation
│   ├── types.ts              # Type definitions
│   └── stream.ts             # Stream transformation utilities
├── tsconfig.json
└── README.md
```

### Implementation: MastraTextAdapter

**File:** `src/adapters/text.ts`

````typescript
import { BaseTextAdapter } from "@tanstack/ai/adapters";
import type {
  DefaultMessageMetadataByModality,
  Modality,
  JSONSchema,
  StreamChunk,
  TextOptions,
  StructuredOutputOptions,
  StructuredOutputResult,
} from "@tanstack/ai/types";
import { ModelRouterLanguageModel, type ModelRouterModelId } from "@mastra/core/llm";

/**
 * Provider options for Mastra models.dev providers
 * Uses Mastra's OpenAI-compatible config format
 */
export interface MastraTextProviderOptions {
  /** Custom API URL (overrides models.dev) */
  url?: string;
  /** Custom API key (overrides environment variable) */
  apiKey?: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Max tokens for generation */
  maxTokens?: number;
  /** Temperature for sampling */
  temperature?: number;
  /** Top-p sampling */
  topP?: number;
  /** Stop sequences */
  stop?: string[];
}

/**
 * Modalities supported by Mastra (depends on underlying model)
 * All modalities are potentially supported since models.dev has many providers
 */
export const MASTRA_INPUT_MODALITIES = ["text", "image", "audio", "video", "pdf"] as const;

/**
 * Message metadata by modality for Mastra
 */
export const MASTRA_METADATA_BY_MODALITY = {
  text: { url: true },
  image: { url: true, mimeType: true },
  audio: { url: true, mimeType: true },
  video: { url: true, mimeType: true },
  pdf: { url: true, mimeType: true },
} as const satisfies DefaultMessageMetadataByModality;

/**
 * TanStack AI text adapter for Mastra's ModelRouterLanguageModel
 *
 * This adapter bridges TanStack AI's adapter pattern with Mastra's
 * gateway system, providing access to all models.dev providers through
 * Mastra's auto-refreshing gateway registry.
 *
 * @example
 * ```ts
 * import { mastraText } from '@tanstack-ai-mastra/adapters'
 * import { chat } from '@tanstack/ai'
 *
 * const adapter = mastraText('openai/gpt-4o')
 * const result = await chat(adapter, {
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * })
 * ```
 */
export class MastraTextAdapter extends BaseTextAdapter<
  ModelRouterModelId,
  MastraTextProviderOptions,
  typeof MASTRA_INPUT_MODALITIES,
  typeof MASTRA_METADATA_BY_MODALITY
> {
  readonly kind = "text" as const;
  readonly name = "mastra" as const;

  private mastraModel: ModelRouterLanguageModel;

  constructor(config: MastraTextProviderOptions = {}, modelId: ModelRouterModelId) {
    super(config, modelId);

    // Create Mastra ModelRouterLanguageModel
    // This will resolve the appropriate gateway (models.dev, netlify, etc.)
    this.mastraModel = new ModelRouterLanguageModel(
      {
        id: modelId,
        url: config.url,
        apiKey: config.apiKey,
        headers: config.headers,
      }
      // Can pass custom gateways here if needed
      // [new CustomGateway(), ...]
    );
  }

  async *chatStream(options: TextOptions<MastraTextProviderOptions>): AsyncIterable<StreamChunk> {
    const { messages, tools, temperature, maxTokens, topP, stop, onStepFinish } = options;

    // Convert TanStack messages to AI SDK format
    const aiSdkMessages = convertToAISDKMessages(messages);

    // Convert tools to AI SDK format
    const aiSdkTools = tools ? convertTools(tools) : undefined;

    // Stream using Mastra's ModelRouterLanguageModel
    const streamResult = await this.mastraModel.doStream({
      messages: aiSdkMessages,
      tools: aiSdkTools,
      temperature,
      maxTokens,
      topP,
      stop,
      abortSignal: options.signal,
    });

    // Transform AI SDK stream to TanStack StreamChunk format
    const stream = streamResult.stream;

    for await (const chunk of stream) {
      switch (chunk.type) {
        case "text-delta":
          yield {
            type: "text-delta",
            text: chunk.text,
          } satisfies StreamChunk;
          break;

        case "tool-call":
          yield {
            type: "tool-call",
            toolCall: {
              toolName: chunk.toolName,
              args: chunk.args,
              toolCallId: chunk.toolCallId,
            },
          } satisfies StreamChunk;
          break;

        case "tool-result":
          yield {
            type: "tool-result",
            toolCallId: chunk.toolCallId,
            result: chunk.result,
            isError: chunk.isError,
          } satisfies StreamChunk;
          break;

        case "error":
          yield {
            type: "error",
            error: chunk.error,
          } satisfies StreamChunk;
          break;

        case "finish":
        case "step-finish":
          // These are handled internally
          onStepFinish?.({
            ...chunk,
            usage: chunk.usage,
            finishReason: chunk.finishReason,
          });
          break;
      }
    }
  }

  async structuredOutput(
    options: StructuredOutputOptions<MastraTextProviderOptions>
  ): Promise<StructuredOutputResult> {
    const { chatOptions, outputSchema } = options;

    // Use Mastra's object generation support
    // Note: ModelRouterLanguageModel supports structured outputs
    const aiSdkMessages = convertToAISDKMessages(chatOptions.messages);

    const result = await this.mastraModel.doGenerate({
      messages: [
        ...aiSdkMessages,
        {
          role: "system",
          content: `Respond only with valid JSON that conforms to the following schema:\n${JSON.stringify(outputSchema)}`,
        },
      ],
      // Use model's structured output mode if available
      // Otherwise, use JSON schema instruction
      temperature: chatOptions.temperature ?? 0,
    });

    // Extract text from stream
    let text = "";
    for await (const chunk of result.stream) {
      if (chunk.type === "text-delta") {
        text += chunk.text;
      }
    }

    // Parse JSON response
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        data = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Failed to parse structured output as JSON");
      }
    }

    return {
      data,
      rawText: text,
    };
  }
}
````

### Factory Function

**File:** `src/adapters/text.ts` (continued)

````typescript
/**
 * Factory function to create a Mastra text adapter
 *
 * @param modelId - Model ID in format 'provider/model' (e.g., 'openai/gpt-4o')
 * @param config - Optional configuration overrides
 * @returns MastraTextAdapter for the specified model
 *
 * @example
 * ```ts
 * import { mastraText } from '@tanstack-ai-mastra/adapters'
 *
 * // Use with default settings (reads from env vars)
 * const adapter = mastraText('openai/gpt-4o')
 *
 * // Use with custom configuration
 * const customAdapter = mastraText('anthropic/claude-sonnet-4-5', {
 *   apiKey: 'sk-custom-key',
 *   temperature: 0.7,
 * })
 * ```
 */
export function mastraText<TModelId extends ModelRouterModelId = ModelRouterModelId>(
  modelId: TModelId,
  config?: Omit<MastraTextProviderOptions, "url" | "apiKey">
): MastraTextAdapter {
  return new MastraTextAdapter(config || {}, modelId);
}
````

### Stream Transformation Utilities

**File:** `src/stream.ts`

```typescript
import type { CoreMessage } from "@ai-sdk/provider";
import type { ModelMessage } from "@tanstack/ai/types";

/**
 * Convert TanStack AI messages to AI SDK format
 */
export function convertToAISDKMessages(messages: ModelMessage[]): CoreMessage[] {
  return messages.map((msg): CoreMessage => {
    switch (msg.role) {
      case "user":
        return {
          role: "user",
          content: Array.isArray(msg.content)
            ? msg.content.map(part => {
                if (part.type === "text") return { type: "text", text: part.text };
                if (part.type === "image") {
                  return {
                    type: "image",
                    image:
                      typeof part.image === "string" ? part.image : new URL(part.image.url).href,
                  };
                }
                return part;
              })
            : [{ type: "text", text: msg.content }],
        };
      case "assistant":
        return {
          role: "assistant",
          content: Array.isArray(msg.content)
            ? msg.content.map(part => {
                if (part.type === "text") return { type: "text", text: part.text };
                if (part.type === "tool-call") {
                  return {
                    type: "tool-call",
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    args: JSON.stringify(part.args),
                  };
                }
                return part;
              })
            : msg.content,
        };
      default:
        return msg as unknown as CoreMessage;
    }
  });
}

/**
 * Convert TanStack tools to AI SDK format
 */
export function convertTools(tools: any[]): any[] {
  // Tool conversion logic
  // This handles the different tool formats between TanStack and AI SDK
  return tools.map(tool => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}
```

### Main Exports

**File:** `src/index.ts`

```typescript
export { MastraTextAdapter, mastraText } from "./adapters/text";
export { convertToAISDKMessages, convertTools } from "./stream";
export type { MastraTextProviderOptions } from "./adapters/text";
```

### Package Configuration

**File:** `package.json`

```json
{
  "name": "@tanstack-ai-mastra",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./adapters": "./dist/adapters/text.js"
  },
  "types": "./dist/index.d.ts",
  "sideEffects": false,
  "peerDependencies": {
    "@mastra/core": "^0.x",
    "@tanstack/ai": "^0.x"
  },
  "dependencies": {
    "@mastra/core": "^0.x",
    "@tanstack/ai": "^0.x"
  },
  "devDependencies": {
    "@tanstack/ai": "workspace:*",
    "@mastra/core": "workspace:*"
  }
}
```

---

## Usage Examples

### Basic Chat with models.dev Provider

```typescript
import { mastraText } from "@tanstack-ai-mastra/adapters";
import { chat } from "@tanstack/ai";

// Create adapter for any models.dev provider/model
const adapter = mastraText("openai/gpt-4o");

// Use with TanStack AI
const result = await chat(adapter, {
  messages: [{ role: "user", content: "Hello from TanStack AI + Mastra!" }],
});

console.log(result.text);
```

### Multiple Providers

```typescript
// OpenAI
const openaiAdapter = mastraText("openai/gpt-4o");

// Anthropic (via models.dev)
const anthropicAdapter = mastraText("anthropic/claude-sonnet-4-5");

// Google Gemini
const geminiAdapter = mastraText("google/gemini-2.5-pro");

// OpenRouter (aggregator)
const openrouterAdapter = mastraText("openrouter/anthropic/claude-sonnet-4-5");

// Custom provider via OpenAI-compatible
const customAdapter = mastraText("my-provider/custom-model", {
  url: "https://my-api.example.com/v1",
  apiKey: "sk-custom",
});
```

### With Tools

```typescript
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

const weatherTool = toolDefinition({
  name: "getWeather",
  inputSchema: z.object({
    city: z.string(),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    condition: z.string(),
    city: z.string(),
  }),
}).server(async ({ city, units }) => {
  // Fetch weather...
  return {
    temperature: 22,
    condition: "Sunny",
    city,
  };
});

const adapter = mastraText("openai/gpt-4o");

const result = await chat(adapter, {
  messages: [{ role: "user", content: "What is the weather in Tokyo?" }],
  tools: [weatherTool],
});
```

### Structured Output

```typescript
import { z } from "zod";
import { generateObject } from "@tanstack/ai";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const adapter = mastraText("openai/gpt-4o");

const result = await generateObject(adapter, {
  output: schema,
  messages: [{ role: "user", content: "Extract user info from: John Doe, 30, john@example.com" }],
});

console.log(result.object);
// { name: 'John Doe', age: 30, email: 'john@example.com' }
```

### Streaming

```typescript
import { streamChat } from "@tanstack/ai";

const adapter = mastraText("openai/gpt-4o");

const { stream } = await streamChat(adapter, {
  messages: [{ role: "user", content: "Tell me a story" }],
});

for await (const chunk of stream) {
  if (chunk.type === "text-delta") {
    process.stdout.write(chunk.text);
  }
}
```

### With Mastra Agents

```typescript
import { Agent } from "@mastra/core";
import { mastraText } from "@tanstack-ai-mastra/adapters";

// Create a Mastra agent
const agent = new Agent({
  name: "researcher",
  instructions: "You are a helpful research assistant.",
  model: {
    provider: "openai",
    model: "gpt-4o",
    // This can use the ModelRouterLanguageModel internally
  },
});

// Or use TanStack AI's chat with Mastra's model routing
const adapter = mastraText("openai/gpt-4o");
const result = await agent.generate("Tell me about quantum computing");
```

---

## Provider Registry Refresh Mechanism

### Three-Tier Loading (Mastra)

```
1. Static Registry (Fastest - Bundled)
   └─→ dist/provider-registry.json
   └─── Generated at build time
   └───> Always available, no network needed

2. Global Cache (Fast - Cross-Project Shared)
   └─→ ~/.cache/mastra/provider-registry.json
   └───> Synced from gateways, shared across all Mastra projects
   └───> Updated by GatewayRegistry.syncGateways()

3. Live Fetch (Latest - On Demand)
   └─→ https://models.dev/api.json
   └───> Fetched when cache is stale (older than refresh interval)
   └───> Used by GatewayRegistry.startAutoRefresh()
```

### Auto-Refresh Configuration

```typescript
import { GatewayRegistry } from "@mastra/core/llm";

// Enable auto-refresh (runs hourly)
GatewayRegistry.getInstance({
  useDynamicLoading: true, // Enable dynamic loading
}).startAutoRefresh(60 * 60 * 1000); // 1 hour interval

// Manual sync
await GatewayRegistry.getInstance().syncGateways();

// Register custom gateways
class CustomGateway extends MastraModelGateway {
  readonly id = "custom";
  readonly name = "Custom Gateway";

  async fetchProviders() {
    /* ... */
  }
  buildUrl(modelId) {
    /* ... */
  }
  getApiKey(modelId) {
    /* ... */
  }
  async resolveLanguageModel({ modelId, providerId, apiKey }) {
    return createOpenAICompatible({ apiKey }).chatModel(modelId);
  }
}

GatewayRegistry.getInstance().registerCustomGateways([new CustomGateway()]);
```

### Environment Variables

```bash
# Enable dynamic loading (for auto-refresh)
MASTRA_DEV=true

# Enable auto-refresh (default: true in dev)
MASTRA_AUTO_REFRESH_PROVIDERS=true

# Custom base URL overrides
OPENAI_BASE_URL=https://custom-proxy.com/v1
ANTHROPIC_BASE_URL=https://custom-proxy.com/v1

# API keys (standard)
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
```

---

## Type Safety and Model Metadata

### TanStack AI's Model Metadata Pattern

TanStack AI uses model metadata for type-safe provider options:

```typescript
// @tanstack/ai-openai/src/model-meta.ts
export type OpenAIChatModelProviderOptionsByName = {
  "gpt-4o": { reasoningEffort?: "low" | "medium" | "high" };
  "gpt-4o-mini": { reasoningEffort?: "low" | "medium" | "high" };
  "o1-mini": { reasoningEffort?: "low" | "medium" | "high" };
  // ...
};

type ResolveProviderOptions<TModel extends string> =
  TModel extends keyof OpenAIChatModelProviderOptionsByName
    ? OpenAIChatModelProviderOptionsByName[TModel]
    : OpenAITextProviderOptions;
```

### Mastra's Type Generation

Mastra generates TypeScript types from the models.dev registry:

```typescript
// Auto-generated from models.dev
export type Provider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'openrouter'
  | // ... 100+ providers

export type ModelForProvider<TProvider extends Provider> =
  TProvider extends 'openai' ? 'gpt-4o' | 'gpt-4o-mini' | 'o1-mini' | ...
  : TProvider extends 'anthropic' ? 'claude-sonnet-4-5' | 'claude-haiku-4-5' | ...
  : TProvider extends 'google' ? 'gemini-2.5-pro' | 'gemini-2.5-flash' | ...
  : ...

export type ModelRouterModelId = `${Provider}/${ModelForProvider<Provider>}`
```

### Combined Type Safety

```typescript
// @tanstack-ai-mastra can provide both models.dev type safety
// and TanStack's adapter type safety

import { mastraText } from "@tanstack-ai-mastra/adapters";

// Type-safe model selection
const adapter1 = mastraText("openai/gpt-4o");
// ✅ Valid - type is ModelRouterModelId

const adapter2 = mastraText("invalid/model");
// ❌ Type error - not a valid ModelRouterModelId

const adapter3 = mastraText("openai/gpt-4o", {
  reasoningEffort: "high", // This could be type-checked if we extend provider options
});
```

---

## Concrete Adapter Specification (Mastra → TanStack AI)

### Scope and Goals

- Provide a `MastraTextAdapter` that implements TanStack AI’s `BaseTextAdapter` and streams TanStack `StreamChunk` objects.
- Delegate model resolution and provider support to Mastra’s `ModelRouterLanguageModel`.
- Support tool calling, structured output, and multimodal inputs where the underlying model supports it.
- Handle edge cases around streaming, tool-call deltas, partial JSON, and provider-specific errors.

### Adapter Public Surface

**Package:** `@tanstack-ai-mastra`

**Exports:**

- `MastraTextAdapter`
- `mastraText(modelId, config?)`
- `MastraTextProviderOptions`
- `convertToAISDKMessages()`
- `convertToolsToAISDK()`

### Adapter Types

```ts
export type MastraTextModelId = ModelRouterModelId;

export type MastraTextProviderOptions = {
  apiKey?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
};

export type MastraInputModalities = readonly ["text", "image", "audio", "video", "document"];

export type MastraMessageMetadataByModality = {
  text: unknown;
  image: { mimeType?: string };
  audio: { mimeType?: string };
  video: { mimeType?: string };
  document: { mimeType?: string };
};
```

### Required Adapter Methods

#### `chatStream(options: TextOptions)`

**Inputs**

- `options.model`: TanStack model string (should match `ModelRouterModelId` format)
- `options.messages`: TanStack `ModelMessage[]`
- `options.tools`: TanStack tools array (optional)
- `options.modelOptions`: provider-specific options (optional)
- `options.temperature`, `options.topP`, `options.maxTokens`, `options.metadata`
- `options.systemPrompts`
- `options.request` (for headers and abort signals)

**Outputs**

- Async iterable of TanStack `StreamChunk`

#### `structuredOutput(options: StructuredOutputOptions)`

**Inputs**

- `chatOptions`: TanStack `TextOptions`
- `outputSchema`: JSON Schema (already converted by TanStack)

**Outputs**

- `StructuredOutputResult` with `data` and `rawText`

### Conversion Rules

#### Message Conversion: TanStack → AI SDK

- `ModelMessage.role === 'user' | 'assistant' | 'tool'` map to AI SDK `CoreMessage` equivalents.
- `content` conversions:
  - `string` → `{ type: 'text', text: string }`.
  - `ContentPart` arrays:
    - `text` → `{ type: 'text', text }`.
    - `image` → `{ type: 'image', image: source.value }` (ensure URL or data URI).
    - `audio` → `{ type: 'audio', audio: source.value }`.
    - `video` → `{ type: 'video', video: source.value }`.
    - `document` → `{ type: 'file', file: source.value, mimeType }`.
- Tool messages (`role: 'tool'`) map to AI SDK tool result messages with `toolCallId`.
- Assistant tool calls should be converted to AI SDK function-call message parts with JSON-stringified arguments.

#### Tool Conversion: TanStack → AI SDK

- TanStack tools map to AI SDK `tool` definitions:
  - `name`, `description`, `inputSchema` (as JSON schema)
- Ensure tool names are lowercased when provider requires it.
- If a tool has `needsApproval`, adapter must emit an `approval-requested` chunk before executing.

### Streaming Mapping (AI SDK → TanStack `StreamChunk`)

The adapter must translate AI SDK stream events into TanStack `StreamChunk` objects with:

- `id`: stable response ID when possible, otherwise generated.
- `model`: model name from event metadata, fallback to `options.model`.
- `timestamp`: set once at stream start.

**Event Mapping Table**

| AI SDK Event Type               | TanStack Chunk | Notes                                       |
| ------------------------------- | -------------- | ------------------------------------------- |
| `text-delta`                    | `content`      | Append to `content`, emit `delta`           |
| `reasoning-delta`               | `thinking`     | Accumulate `content` for reasoning          |
| `tool-call`                     | `tool_call`    | Emit with `{ id, name, arguments }`         |
| `tool-result`                   | `tool_result`  | Emit with `toolCallId` + serialized content |
| `error`                         | `error`        | Map message + code                          |
| `finish` / `response.completed` | `done`         | Include `finishReason` + `usage`            |

### Edge Cases and Required Behavior

1. **Partial tool arguments**
   - If AI SDK streams partial arguments, buffer per `toolCallId` and emit `tool_call` only when arguments are complete.

2. **Tool call ordering**
   - Preserve `index` ordering for `tool_call` chunks.
   - Use stable ordering even if provider emits interleaved text/tool deltas.

3. **Missing finish reason**
   - Default `finishReason` to `stop` if provider does not send one.

4. **Tool approval flow**
   - If any tool has `needsApproval`, emit `approval-requested` chunk and suspend tool execution until approval is returned.
   - If approval denied, emit `tool_result` with error state and continue stream safely.

5. **Structured output fallback**
   - Prefer provider-native schema (OpenAI `json_schema`, Anthropic tool schema, Gemini schema).
   - If no native support, inject a system instruction with schema and parse JSON with tolerant extraction (code block parsing + JSON parse).

6. **Model option precedence**
   - Allow `options.modelOptions` to override adapter defaults.
   - Merge `temperature/topP/maxTokens/metadata` with `modelOptions` for final provider payload.

7. **Multimodal mismatch**
   - TanStack uses `document` modality, while models.dev might expose `pdf`.
   - Map `pdf` → `document` and set `mimeType: application/pdf`.

8. **Error wrapping**
   - Wrap provider errors into TanStack `error` chunk with `code` when available.
   - Do not throw synchronously after yielding an error chunk unless stream is irrecoverable.

9. **Abort handling**
   - Respect `options.request.signal` and `options.abortController` if present.
   - Ensure Mastra’s underlying call receives the abort signal.

10. **Usage accounting**

- Use `promptTokens`, `completionTokens`, `totalTokens` when provided.
- If provider uses different keys (input/output/total), map accordingly.

### Pseudocode (Core Path)

```ts
async *chatStream(options) {
  const timestamp = Date.now()
  const streamId = genId()
  const toolBuffers = new Map()
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  const aiSdkMessages = convertToAISDKMessages(options.messages)
  const aiSdkTools = options.tools ? convertToolsToAISDK(options.tools) : undefined

  const stream = await mastraModel.doStream({
    messages: aiSdkMessages,
    tools: aiSdkTools,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    topP: options.topP,
    metadata: options.metadata,
    providerOptions: options.modelOptions,
    abortSignal: options.request?.signal ?? options.abortController?.signal,
  })

  for await (const event of stream.fullStream) {
    switch (event.type) {
      case 'text-delta':
        yield toContentChunk(event, streamId, timestamp)
        break
      case 'tool-call':
        bufferToolArgs(toolBuffers, event)
        if (toolArgsComplete(event)) yield toToolCallChunk(event)
        break
      case 'tool-result':
        yield toToolResultChunk(event)
        break
      case 'error':
        yield toErrorChunk(event)
        break
      case 'finish':
        yield toDoneChunk(event, usage)
        break
    }
  }
}
```

### Test Matrix (Minimum)

- **Streaming**: text-only prompt (verifies `content` + `done`).
- **Tool call**: single tool call (verifies `tool_call` + `tool_result`).
- **Tool approval**: `needsApproval` tool, deny path.
- **Structured output**: valid JSON schema with nested types.
- **Multimodal**: image + document inputs.
- **Abort**: abort mid-stream and ensure clean termination.
- **Provider fallback**: OpenAI-compatible provider via `models.dev`.

---

## Implementation Roadmap

### Phase 1: Core Adapter (MVP)

**Goal:** Basic TanStack AI adapter for Mastra

- [ ] Create `@tanstack-ai-mastra` package
- [ ] Implement `MastraTextAdapter` extending `BaseTextAdapter`
- [ ] Implement `chatStream()` with basic streaming
- [ ] Add message conversion utilities
- [ ] Test with a few models.dev providers (openai, anthropic)

**Deliverables:**

- Working adapter with `chat()` function
- Basic streaming support
- No structured output yet

### Phase 2: Full Feature Parity

**Goal:** Complete TanStack AI feature support

- [ ] Implement `structuredOutput()` method
- [ ] Support tool calling
- [ ] Add multimodal content (images, audio, video)
- [ ] Support agent loops with tool execution
- [ ] Add error handling and retry logic

**Deliverables:**

- Full `chat()` function support
- `generateObject()` support
- Tool execution
- Comprehensive error handling

### Phase 3: Type Safety and Metadata

**Goal:** Type-safe model selection and options

- [ ] Integrate with Mastra's generated types
- [ ] Add per-model option type inference
- [ ] Support model variants (reasoning effort, etc.)
- [ ] Generate types from models.dev registry

**Deliverables:**

- Type-safe model IDs
- Type-safe provider options per model
- Model variant support

### Phase 4: Advanced Features

**Goal:** Advanced TanStack AI + Mastra integration

- [ ] Support for Mastra's custom gateways
- [ ] Support for Netlify gateway
- [ ] Embedding adapter
- [ ] Image generation adapter
- [ ] Voice/speech adapters

**Deliverables:**

- Multi-adapter support (text, embed, image, voice)
- Custom gateway registration
- Full gateway ecosystem support

### Phase 5: Ekacode Integration

**Goal:** Integrate into Ekacode project

- [ ] Add Ekacode-specific configuration
- [ ] Integrate with Ekacode's tool system
- [ ] Add Ekacode agent templates
- [ ] Documentation and examples

**Deliverables:**

- Ekacode-specific configuration
- Tool integration
- Agent templates
- Complete documentation

---

## File Structure Reference

### Mastra LLM System

```
mastra/packages/core/src/llm/model/
├── gateways/
│   ├── base.ts                    # MastraModelGateway abstract class
│   ├── models-dev.ts               # ModelsDevGateway implementation
│   ├── netlify.ts                  # NetlifyGateway implementation
│   ├── azure.ts                    # AzureGateway implementation
│   ├── index.ts                    # Gateway exports and utilities
│   └── constants.ts                # Provider constants
├── provider-registry.ts            # GatewayRegistry singleton
├── provider-registry.json          # Generated provider data
├── provider-types.generated.d.ts    # Generated TypeScript types
├── router.ts                       # ModelRouterLanguageModel
├── router-custom-provider.test.ts  # Custom provider tests
├── model.ts                        # Main model exports
├── model.loop.ts                   # Agent loop execution
└── shared.types.ts                 # Shared LLM types
```

### TanStack AI System

```
tanstack-ai/packages/typescript/
├── ai/src/
│   ├── index.ts                    # Main exports
│   ├── types.ts                    # Core type definitions
│   ├── activities/
│   │   ├── chat/
│   │   │   ├── index.ts            # Chat activity
│   │   │   ├── adapter.ts          # BaseTextAdapter interface
│   │   │   └── tools/              # Tool system
│   │   ├── summarize/
│   │   ├── generateImage/
│   │   └── generateSpeech/
│   ├── adapters/                   # Base adapter exports
│   └── stream/                     # Stream processing
├── ai-openai/src/
│   ├── adapters/
│   │   └── text.ts                 # OpenAI text adapter
│   └── model-meta.ts               # OpenAI model metadata
├── ai-anthropic/src/
│   └── adapters/
│       └── text.ts                 # Anthropic adapter
├── ai-gemini/src/
│   └── adapters/
│       └── text.ts                 # Gemini adapter
└── ai-ollama/src/
    └── adapters/
        └── text.ts                 # Ollama adapter
```

---

## Comparison: OpenCode vs Mastra + TanStack AI

### OpenCode Approach

```typescript
// Direct use of AI SDK with custom provider loading
import { Provider } from "@opencode-ai/opencode/provider";

const modelsDev = await Provider.ModelsDev.get();
const provider = await Provider.getProvider("openai");
const model = await Provider.getModel("openai", "gpt-4o");
const languageModel = await Provider.getLanguage(model);

// Direct streaming
const result = streamText({ model: languageModel, messages });
```

**Pros:**

- Full control over AI SDK
- Custom provider loaders
- Integrated tool system
- Permission handling

**Cons:**

- Tied to OpenCode's architecture
- Heavy customization for new providers
- Not framework-agnostic

### Mastra + TanStack AI Approach

```typescript
// Use Mastra's gateway through TanStack's adapter
import { mastraText } from "@tanstack-ai-mastra/adapters";
import { chat } from "@tanstack/ai";

const adapter = mastraText("openai/gpt-4o");
const result = await chat(adapter, { messages });

// Or use Mastra's agent system
import { Agent } from "@mastra/core";

const agent = new Agent({
  model: { provider: "openai", model: "gpt-4o" },
  tools: [
    /* Mastra tools */
  ],
});
```

**Pros:**

- Framework-agnostic adapter
- TanStack's tool system
- Mastra's gateway auto-refresh
- Type-safe model selection
- Easier to add new providers (just add to models.dev)

**Cons:**

- Two systems to understand
- Adapter layer adds complexity
- Need to maintain both ecosystems

---

## Key Design Decisions

### 1. Use Mastra's ModelRouterLanguageModel as Backend

**Decision:** Mastra's `ModelRouterLanguageModel` already handles:

- Gateway resolution (models.dev, netlify, custom)
- API key management
- URL building
- Provider-specific model creation

**Benefit:** Don't need to reimplement models.dev integration

### 2. Adapter Wraps ModelRouterLanguageModel

**Decision:** Create `MastraTextAdapter` that wraps `ModelRouterLanguageModel` and implements TanStack's `BaseTextAdapter` interface

**Benefit:** Clean separation between TanStack's adapter pattern and Mastra's gateway system

### 3. Lazy Gateway Registration

**Decision:** Mastra's gateways are registered at startup, with auto-refresh every hour

**Benefit:** Always have latest models.dev data without manual updates

### 4. Support Custom Gateways

**Decision:** Allow custom gateways to be registered for private providers

**Benefit:** Can support enterprise/private providers not on models.dev

### 5. Type Generation from models.dev

**Decision:** Generate TypeScript types from models.dev registry

**Benefit:** Type-safe model IDs at compile time

---

## Testing Strategy

### Unit Tests

```typescript
describe("MastraTextAdapter", () => {
  it("should create adapter for valid model ID", () => {
    const adapter = mastraText("openai/gpt-4o");
    expect(adapter.model).toBe("openai/gpt-4o");
  });

  it("should stream text from model", async () => {
    const adapter = mastraText("openai/gpt-4o", {
      apiKey: "test-key",
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of adapter.chatStream({
      messages: [{ role: "user", content: "Test" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some(c => c.type === "text-delta")).toBe(true);
  });

  it("should handle tool calls", async () => {
    const adapter = mastraText("openai/gpt-4o");
    const tool = testTool();

    const result = await chat(adapter, {
      messages: [{ role: "user", content: "Use the tool" }],
      tools: [tool],
    });

    expect(result.toolCalls).toBeDefined();
  });
});
```

### Integration Tests

```typescript
describe("Mastra + TanStack AI Integration", () => {
  it("should work with multiple providers", async () => {
    const providers = ["openai", "anthropic", "google"];

    for (const provider of providers) {
      const adapter = mastraText(`${provider}/latest` as ModelRouterModelId);
      const result = await chat(adapter, {
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.text).toBeDefined();
    }
  });

  it("should support structured output", async () => {
    const adapter = mastraText("openai/gpt-4o");
    const schema = z.object({ name: z.string() });

    const result = await generateObject(adapter, {
      output: schema,
      messages: [{ role: "user", content: "Extract name: John" }],
    });

    expect(result.object).toEqual({ name: "John" });
  });
});
```

---

## Migration Path from OpenCode

If migrating from OpenCode's provider system:

### OpenCode Code

```typescript
import { Provider } from "@opencode-ai/opencode/provider";

const provider = await Provider.getProvider("openai");
const model = await Provider.getModel("openai", "gpt-4o");
const languageModel = await Provider.getLanguage(model);
```

### Mastra + TanStack AI Equivalent

```typescript
import { mastraText } from "@tanstack-ai-mastra/adapters";
import { chat } from "@tanstack/ai";

const adapter = mastraText("openai/gpt-4o");
const result = await chat(adapter, { messages });
```

### Key Differences

| Feature             | OpenCode | Mastra + TanStack AI  |
| ------------------- | -------- | --------------------- |
| Provider resolution | Manual   | Gateway system (auto) |
| Model registry      | Custom   | models.dev (standard) |
| Refresh mechanism   | Custom   | Built-in auto-refresh |
| Tool system         | Custom   | TanStack tools        |
| Adapter pattern     | N/A      | TanStack adapters     |
| Type safety         | Zod      | Generated + Zod       |

---

## Conclusion

The integration strategy leverages:

1. **Mastra's existing models.dev gateway** - No need to reimplement
2. **TanStack AI's adapter pattern** - Clean, framework-agnostic
3. **ModelRouterLanguageModel** - Unified model interface
4. **Auto-refreshing registry** - Always up-to-date models

The `@tanstack-ai-mastra` package will provide:

- Access to 100+ providers through models.dev
- TanStack's clean adapter API
- Type-safe model selection
- Auto-refreshing provider registry
- Support for custom gateways

This approach combines the strengths of both ecosystems while maintaining clean separation of concerns.
