# Z.ai Provider Implementation Plan (DONE)

## Cohesion Addendum (2026-01-28)
Aligned to `00-cohesion-summary.md`.

Key overrides:
- AI SDK target: **v6**; any v3 wording is historical.
- HybridAgent is **used by XState Plan/Build** (provider layer, not orchestrator).
- Z.ai-first is canonical for now; keep provider-agnostic compatibility.

---

> Comprehensive implementation plan for `@ai-sdk/zai` - A Vercel AI SDK provider for Z.ai's GLM models

## Table of Contents

1. [Overview](#overview)
2. [Z.ai API Capabilities](#zai-api-capabilities)
3. [File Structure](#file-structure)
4. [Type Definitions](#type-definitions)
5. [Implementation Details](#implementation-details)
6. [Testing Strategy](#testing-strategy)
7. [Documentation](#documentation)

---

## Overview

### Goal

Create a fully-featured Vercel AI SDK v6 provider for Z.ai that supports all documented capabilities including:

- Chat completions with streaming
- Function calling (tools)
- Thinking modes (interleaved, preserved, turn-level)
- Context caching (preserved thinking)
- Web search tools
- Retrieval tools
- Structured output (JSON mode)
- Vision/multimodal support
- Tool streaming (tool_stream)

### Reference Implementation

Based on the `@ai-sdk/openai` provider pattern:

- `LanguageModelV3` interface compliance
- Provider factory pattern
- Zod-based schema validation
- TransformStream for streaming responses
- Provider options parsing

### Key Dependencies

```json
{
  "dependencies": {
    "@ai-sdk/provider": "workspace:*",
    "@ai-sdk/provider-utils": "workspace:*"
  }
}
```

---

## Z.ai API Capabilities

### Models

| Model ID                     | Type      | Special Features                             |
| ---------------------------- | --------- | -------------------------------------------- |
| `glm-4.7`                    | Text/Chat | Default thinking enabled, preserved thinking |
| `glm-4.7-flash`              | Text/Chat | Faster variant                               |
| `glm-4.7-flashx`             | Text/Chat | Enhanced flash                               |
| `glm-4.6`                    | Text/Chat | General chat                                 |
| `glm-4.6v`                   | Vision    | Image/video/file input                       |
| `glm-4.5`                    | Text/Chat | Basic support                                |
| `glm-4.5v`                   | Vision    | Image input                                  |
| `autoglm-phone-multilingual` | Special   | Mobile assistant                             |

Tool streaming (`tool_stream`) is supported by the API and is not limited to a single model in the official SDK.

### Endpoints

| Purpose           | URL                                    |
| ----------------- | -------------------------------------- |
| Standard API      | `https://api.z.ai/api/paas/v4`         |
| Coding API        | `https://api.z.ai/api/coding/paas/v4`  |
| China (Zhipu) API | `https://open.bigmodel.cn/api/paas/v4` |

### Parameter Mapping

| AI SDK Parameter   | Z.ai Parameter         | Notes                                                                                        |
| ------------------ | ---------------------- | -------------------------------------------------------------------------------------------- |
| `temperature`      | `temperature`          | Range: (0.0, 1.0); clamp to 0.01–0.99. If `<=0`, set `do_sample=false`.                      |
| `maxOutputTokens`  | `max_tokens`           | GLM-4.7: 128K max                                                                            |
| `topP`             | `top_p`                | Range: (0.0, 1.0); clamp to 0.01–0.99                                                        |
| `stopSequences`    | `stop`                 | Array of strings                                                                             |
| `tools`            | `tools`                | Function calling                                                                             |
| `toolChoice`       | `tool_choice`          | Accepts string or tool selection; pass through                                               |
| `responseFormat`   | `response_format`      | Map `{ type: 'json' }` → `{ type: 'json_object' }`; warn if schema/name/description provided |
| `presencePenalty`  | Not supported          | -                                                                                            |
| `frequencyPenalty` | Not supported          | -                                                                                            |
| `topK`             | Not supported          | -                                                                                            |
| `seed`             | `seed`                 | Supported by API                                                                             |
| (n/a)              | `do_sample`            | Set `false` when `temperature <= 0`                                                          |
| (n/a)              | `request_id`           | Supported by API                                                                             |
| (n/a)              | `user_id`              | Supported by API                                                                             |
| (n/a)              | `meta`                 | Supported by API                                                                             |
| (n/a)              | `sensitive_word_check` | Supported by API                                                                             |
| (n/a)              | `watermark_enabled`    | Supported by API                                                                             |

### Z.ai-Specific Parameters

```typescript
interface ZaiProviderOptions {
  // Thinking mode configuration
  thinking?: {
    type: "enabled" | "disabled";
    clear_thinking?: boolean; // false for preserved thinking
  };

  // Tool streaming
  tool_stream?: boolean;

  // Web search tool
  web_search?: {
    enable: boolean;
    search_query?: string;
    search_result?: boolean;
    require_search?: boolean;
    search_domain_filter?: string;
    search_recency_filter?: "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | "noLimit";
    content_size?: "medium" | "high";
    result_sequence?: "before" | "after";
  };

  // Retrieval tool
  retrieval?: {
    knowledge_id: string;
    prompt_template?: string;
  };

  // API request extras (pass-through)
  request_id?: string;
  user_id?: string;
  seed?: number;
  do_sample?: boolean;
  meta?: Record<string, string>;
  sensitive_word_check?: {
    type?: string;
    status?: string;
  };
  watermark_enabled?: boolean;
  extra?: Record<string, unknown>;
}
```

---

## File Structure

```
packages/zai/ [existing]
├── src/ [existing]
│   ├── chat/ [existing]
│   │   ├── zai-chat-language-model.ts [new]      # Main chat model implementation
│   │   ├── convert-to-zai-chat-messages.ts [existing] # AI SDK → Z.ai format
│   │   ├── map-zai-chat-response.ts [existing]        # Z.ai → AI SDK format
│   │   ├── zai-chat-prompt.ts [existing]              # AI SDK prompt types
│   │   ├── zai-chat-api.ts [existing]                 # Z.ai API schemas
│   │   ├── zai-chat-settings.ts [existing]            # Provider options schema
│   │   ├── zai-chat-prepare-tools.ts [new]       # Tool preparation
│   │   └── zai-language-model-capabilities.ts [new] # Model capabilities
│   ├── zai-provider.ts [existing]                     # Provider factory
│   ├── zai-error.ts [existing]                         # Error handling
│   ├── zai-constants.ts [existing]                     # Constants (baseURL, etc)
│   ├── index.ts [existing]                             # Public exports
│   └── version.ts [existing]                           # Package version
├── CHANGELOG.md [existing]
├── package.json [existing]
├── README.md [existing]
├── tsconfig.json [existing]
└── tsconfig.with-examples.json [new]

packages/core/
├── src/ [existing]
│   ├── agents/ [new]
│   │   └── hybrid-agent/ [new]
│   │       ├── hybrid-agent.ts [new]             # LanguageModelV3 implementation
│   │       ├── intent-classifier.ts [new]        # Intent detection logic
│   │       ├── prompt-registry.ts [new]          # Prompt registry
│   │       ├── prompts/ [new]                    # Prompt definitions
│   │       │   ├── ui-to-artifact.ts [new]
│   │       │   ├── text-extraction.ts [new]
│   │       │   ├── error-diagnosis.ts [new]
│   │       │   ├── diagram-analysis.ts [new]
│   │       │   ├── data-viz.ts [new]
│   │       │   ├── ui-diff.ts [new]
│   │       │   └── general-image.ts [new]
│   │       ├── zai-hybrid-agent.ts [new]         # Z.ai adapter factory
│   │       ├── vision-request-handler.ts [new]   # Vision model calling
│   │       ├── prompt-injector.ts [new]          # Inject vision analysis into prompt
│   │       ├── image-utils.ts [new]              # Image detection + extraction
│   │       ├── types.ts [new]                    # Agent-specific types
│   │       └── index.ts [new]                    # Agent exports
│   └── index.ts [existing]                             # Public exports
├── tests/ [existing]
│   └── agents/ [new]
│       └── hybrid-agent/ [new]
│           ├── intent-classifier.test.ts [new]
│           ├── vision-request.test.ts [new]
│           ├── prompt-injector.test.ts [new]
│           └── e2e-scenarios.test.ts [new]
├── examples/ [existing]
│   └── hybrid-agent.ts [new]
├── package.json [existing]
├── tsconfig.json [existing]
└── README.md [existing]
```

---

## Type Definitions

### Model IDs

```typescript
// zai-chat-settings.ts
export type ZaiChatModelId =
  | "glm-4.7"
  | "glm-4.7-flash"
  | "glm-4.7-flashx"
  | "glm-4.6"
  | "glm-4.6v"
  | "glm-4.6v-flash"
  | "glm-4.6v-flashx"
  | "glm-4.5"
  | "glm-4.5-air"
  | "glm-4.5-x"
  | "glm-4.5-airx"
  | "glm-4.5-flash"
  | "glm-4.5v"
  | "autoglm-phone-multilingual"
  | (string & {});
```

### API Request/Response Types

```typescript
// zai-chat-api.ts
export interface ZaiChatRequest {
  model: string;
  messages: ZaiChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  seed?: number;
  stop?: string[];
  stream?: boolean;
  thinking?: {
    type: "enabled" | "disabled";
    clear_thinking?: boolean;
  };
  tool_stream?: boolean;
  tools?: ZaiTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  response_format?: { type: "text" | "json_object" } | object;
  user_id?: string;
  do_sample?: boolean;
  request_id?: string;
  meta?: Record<string, string>;
  sensitive_word_check?: {
    type?: string;
    status?: string;
  };
  watermark_enabled?: boolean;
  extra?: Record<string, unknown>;
}

export interface ZaiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | ZaiContentPart[];
  tool_calls?: ZaiToolCall[];
  tool_call_id?: string;
  reasoning_content?: string; // For preserved thinking
}

export type ZaiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  // video_url/file_url support is unverified in the official Python SDK
  | { type: "video_url"; video_url: { url: string } }
  | { type: "file_url"; file_url: { url: string } };

export interface ZaiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ZaiTool {
  type: "function" | "web_search" | "retrieval";
  function?: {
    name: string;
    description: string;
    parameters: JSONSchema7;
  };
  web_search?: {
    enable: boolean;
    search_engine?: "search_pro_jina";
    search_query?: string;
    search_result?: boolean;
    require_search?: boolean;
    search_domain_filter?: string;
    search_recency_filter?: "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | "noLimit";
    content_size?: "medium" | "high";
    result_sequence?: "before" | "after";
  };
  retrieval?: {
    knowledge_id: string;
    prompt_template?: string;
  };
}

export interface ZaiChatResponse {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content?: string;
      reasoning_content?: string;
      tool_calls?: ZaiToolCall[];
    };
    finish_reason: "stop" | "tool_calls" | "length" | "sensitive" | "network_error";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens: number };
    completion_tokens_details?: { reasoning_tokens: number };
  };
  web_search?: Array<{
    title: string;
    content: string;
    link: string;
    media: string;
    icon: string;
    refer: string;
    publish_date: string;
  }>;
}

export interface ZaiChatChunk {
  id: string;
  created?: number;
  model?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: ZaiChatResponse["usage"];
}
```

### Error Types

```typescript
// zai-error.ts
export const zaiErrorDataSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.union([z.string(), z.number()]).nullish(),
    type: z.string().nullish(),
    param: z.any().nullish(),
  }),
});

export const zaiFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: zaiErrorDataSchema,
  errorToMessage: data => data.error.message,
});
```

---

## Implementation Details

### 1. Provider Factory (`zai-provider.ts`)

```typescript
import { ProviderV3 } from "@ai-sdk/provider";
import { ZaiChatLanguageModel } from "./chat/zai-chat-language-model";
import { ZaiChatModelId } from "./chat/zai-chat-settings";

export interface ZaiProvider extends ProviderV3 {
  (modelId: ZaiChatModelId): LanguageModelV3;
  languageModel(modelId: ZaiChatModelId): LanguageModelV3;
  chat(modelId: ZaiChatModelId): LanguageModelV3;
}

export interface ZaiProviderSettings {
  /**
   * Convenience endpoint selector.
   * - 'general' => https://api.z.ai/api/paas/v4
   * - 'coding'  => https://api.z.ai/api/coding/paas/v4
   */
  endpoint?: "general" | "coding";
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /**
   * Overrides default x-source-channel header (default: 'typescript-sdk').
   */
  sourceChannel?: string;
  fetch?: FetchFunction;
}

export function createZai(options: ZaiProviderSettings = {}): ZaiProvider {
  const endpointBaseURL =
    options.endpoint === "coding"
      ? "https://api.z.ai/api/coding/paas/v4"
      : "https://api.z.ai/api/paas/v4";

  const baseURL = withoutTrailingSlash(
    options.baseURL ??
      loadOptionalSetting({
        settingValue: options.baseURL,
        environmentVariableName: "ZAI_BASE_URL",
      }) ??
      endpointBaseURL
  );

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: "ZAI_API_KEY",
          description: "Z.ai",
        })}`,
        "x-source-channel": options.sourceChannel ?? "typescript-sdk",
        "Accept-Language": "en-US,en",
        ...options.headers,
      },
      `ai-sdk/zai/${VERSION}`
    );

  const createChatModel = (modelId: ZaiChatModelId) =>
    new ZaiChatLanguageModel(modelId, {
      provider: "zai.chat",
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const provider = function (modelId: ZaiChatModelId) {
    return createChatModel(modelId);
  };

  provider.specificationVersion = "v3" as const;
  provider.languageModel = createChatModel;
  provider.chat = createChatModel;

  return provider as ZaiProvider;
}

export const zai = createZai();
```

Header notes:

- Always send `Authorization: Bearer <apiKey>`.
- Include `x-source-channel` (default `typescript-sdk`) and `Accept-Language: en-US,en`.
- Optionally support JWT signing when API key is in `<api_key>.<secret>` format.

### 2. Chat Language Model (`zai-chat-language-model.ts`)

Key implementation points:

1. **Constructor**: Set `supportedUrls` for image URL/data support
2. **getArgs()**: Convert AI SDK options to Z.ai format
3. **doGenerate()**: Non-streaming API call
4. **doStream()**: Streaming with TransformStream

getArgs() specifics aligned to official SDK:

- Clamp `temperature` and `top_p` to the open interval (0,1). If `temperature <= 0`, set `do_sample=false`.
- Allow `tool_choice` pass-through (string or explicit tool selection), no forced `'auto'`.
- Accept pass-through fields: `request_id`, `user_id`, `meta`, `seed`, `sensitive_word_check`, `watermark_enabled`, `extra`.
- Normalize `image_url` payloads by stripping the `data:image/*;base64,` prefix.
- Map `responseFormat.type === 'json'` to `response_format: { type: 'json_object' }` and warn if a schema/name/description is provided.
- Emit warnings for unsupported `topK`, `presencePenalty`, `frequencyPenalty`.

doGenerate() specifics for AI SDK v6:

- Use `createJsonResponseHandler` and capture `rawValue` from `postJsonToApi` to include `response.body`.
- Attach `response` metadata via `getZaiResponseMetadata` and include `responseHeaders`.

```typescript
export class ZaiChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3";
  readonly modelId: ZaiChatModelId;

  readonly supportedUrls = {
    "image/*": [/^https?:\/\/.*$/, /^data:image\/.*$/],
  };

  private readonly config: ZaiChatConfig;

  constructor(modelId: ZaiChatModelId, config: ZaiChatConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  // ... implementation
}
```

### 3. Message Conversion (`convert-to-zai-chat-messages.ts`)

```typescript
export function convertToZaiChatMessages({ prompt }: { prompt: LanguageModelV3Prompt }): {
  messages: ZaiChatMessage[];
  warnings: SharedV3Warning[];
} {
  const messages: ZaiChatMessage[] = [];
  const warnings: SharedV3Warning[] = [];

  for (const { role, content } of prompt) {
    switch (role) {
      case "system": {
        messages.push({
          role: "system",
          content,
        });
        break;
      }
      case "user": {
        if (content.length === 1 && content[0].type === "text") {
          messages.push({ role: "user", content: content[0].text });
          break;
        }

        // Handle multimodal content
        const parts: ZaiContentPart[] = [];
        for (const part of content) {
          switch (part.type) {
            case "text":
              parts.push({ type: "text", text: part.text });
              break;
            case "file": {
              if (part.mediaType.startsWith("image/")) {
                const mediaType = part.mediaType === "image/*" ? "image/jpeg" : part.mediaType;
                const url =
                  part.data instanceof URL
                    ? part.data.toString()
                    : `data:${mediaType};base64,${convertToBase64(part.data)}`;

                parts.push({
                  type: "image_url",
                  image_url: { url },
                });
              } else {
                warnings.push({
                  type: "unsupported",
                  feature: `file mediaType: ${part.mediaType}`,
                });
              }
              break;
            }
          }
        }
        messages.push({ role: "user", content: parts });
        break;
      }
      case "assistant": {
        const assistantMessage: ZaiChatMessage = { role: "assistant" };

        let text = "";
        let reasoning = "";
        const toolCalls: ZaiToolCall[] = [];

        for (const part of content) {
          switch (part.type) {
            case "text": {
              text += part.text;
              break;
            }
            case "reasoning": {
              reasoning += part.text;
              break;
            }
            case "tool-call": {
              toolCalls.push({
                id: part.toolCallId,
                type: "function",
                function: {
                  name: part.toolName,
                  arguments: JSON.stringify(part.input),
                },
              });
              break;
            }
          }
        }

        if (text.length > 0) {
          assistantMessage.content = text;
        }
        if (reasoning.length > 0) {
          assistantMessage.reasoning_content = reasoning;
        }
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }

        messages.push(assistantMessage);
        break;
      }
      case "tool": {
        for (const toolResponse of content) {
          if (toolResponse.type === "tool-approval-response") {
            continue;
          }
          const output = toolResponse.output;
          let contentValue: string;
          switch (output.type) {
            case "text":
            case "error-text":
              contentValue = output.value;
              break;
            case "execution-denied":
              contentValue = output.reason ?? "Tool execution denied.";
              break;
            case "json":
            case "error-json":
            case "content":
              contentValue = JSON.stringify(output.value);
              break;
          }

          messages.push({
            role: "tool",
            tool_call_id: toolResponse.toolCallId,
            content: contentValue,
          });
        }
        break;
      }
    }
  }

  return { messages, warnings };
}
```

**Important:** Before sending the request, strip the `data:image/*;base64,` prefix from any `image_url.url` values (Z.ai Python SDK does this). Keep accepting data URLs from the SDK input, but normalize them to raw base64 in the outbound payload.

### 4. Response Mapping (`map-zai-chat-response.ts`)

```typescript
export function mapZaiChatResponse({
  response,
  warnings,
}: {
  response: ZaiChatResponse;
  warnings: SharedV3Warning[];
}): LanguageModelV3GenerateResult {
  const choice = response.choices[0];
  const content: LanguageModelV3Content[] = [];

  // Add reasoning content if present
  if (choice.message.reasoning_content) {
    content.push({
      type: "reasoning",
      text: choice.message.reasoning_content,
    });
  }

  // Add text content
  if (choice.message.content) {
    content.push({
      type: "text",
      text: choice.message.content,
    });
  }

  // Add tool calls
  for (const toolCall of choice.message.tool_calls ?? []) {
    content.push({
      type: "tool-call",
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      input: toolCall.function.arguments,
    });
  }

  // Add web search results as sources
  for (const searchResult of response.web_search ?? []) {
    content.push({
      type: "source",
      sourceType: "url",
      id: generateId(),
      url: searchResult.link,
      title: searchResult.title,
    });
  }

  return {
    content,
    finishReason: {
      unified: mapZaiFinishReason(choice.finish_reason),
      raw: choice.finish_reason,
    },
    usage: convertZaiChatUsage(response.usage),
    warnings,
  };
}

// In doGenerate, attach request/response metadata:
// - request: { body }
// - response: { ...getZaiResponseMetadata(response), headers: responseHeaders, body: rawResponse }

function convertZaiChatUsage(usage: ZaiChatResponse["usage"] | undefined): LanguageModelV3Usage {
  if (usage == null) {
    return {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
      raw: undefined,
    };
  }

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;

  return {
    inputTokens: {
      total: promptTokens,
      noCache: promptTokens - cachedTokens,
      cacheRead: cachedTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: completionTokens,
      text: completionTokens - reasoningTokens,
      reasoning: reasoningTokens,
    },
    raw: usage,
  };
}

function mapZaiFinishReason(
  finishReason: string
): "stop" | "length" | "tool-calls" | "error" | "other" {
  switch (finishReason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool-calls";
    case "sensitive":
      return "content-filter";
    case "network_error":
      return "error";
    default:
      return "other";
  }
}

function getZaiResponseMetadata(
  value: ZaiChatResponse | ZaiChatChunk
): LanguageModelV3ResponseMetadata {
  return {
    id: value.id,
    modelId: "model" in value ? value.model : undefined,
    timestamp:
      "created" in value && value.created != null ? new Date(value.created * 1000) : undefined,
  };
}
```

### 5. Streaming Implementation

```typescript
async doStream(
  options: LanguageModelV3CallOptions,
): Promise<LanguageModelV3StreamResult> {
  const { args, warnings } = await this.getArgs(options);

  const body = {
    ...args,
    stream: true,
  };

  const { responseHeaders, value: response } = await postJsonToApi({
    url: this.config.url({
      path: '/chat/completions',
      modelId: this.modelId,
    }),
    headers: combineHeaders(this.config.headers(), options.headers),
    body,
    failedResponseHandler: zaiFailedResponseHandler,
    successfulResponseHandler: createEventSourceResponseHandler(
      zaiChatChunkSchema,
    ),
    abortSignal: options.abortSignal,
    fetch: this.config.fetch,
  });

  const toolCalls: Map<number, {
    id: string;
    name: string;
    arguments: string;
  }> = new Map();

  let finishReason: LanguageModelV3FinishReason = {
    unified: 'other',
    raw: undefined,
  };
  let usage: ZaiChatResponse['usage'] | undefined = undefined;
  let metadataExtracted = false;
  let isActiveText = false;
  let isActiveReasoning = false;

  return {
    stream: response.pipeThrough(
      new TransformStream<ParseResult<ZaiChatChunk>, LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings });
        },

        transform(chunk, controller) {
          if (options.includeRawChunks) {
            controller.enqueue({ type: 'raw', rawValue: chunk.rawValue });
          }

          if (!chunk.success) {
            finishReason = { unified: 'error', raw: undefined };
            controller.enqueue({ type: 'error', error: chunk.error });
            return;
          }

          const value = chunk.value;

          if (!metadataExtracted) {
            const metadata = getZaiResponseMetadata(value);
            if (Object.values(metadata).some(Boolean)) {
              metadataExtracted = true;
              controller.enqueue({ type: 'response-metadata', ...metadata });
            }
          }

          if (value.usage != null) {
            usage = value.usage;
          }

          const choice = value.choices[0];

          if (choice?.finish_reason != null) {
            finishReason = {
              unified: mapZaiFinishReason(choice.finish_reason),
              raw: choice.finish_reason,
            };
          }

          if (choice?.delta == null) {
            return;
          }

          const delta = choice.delta;

          // Handle reasoning content (thinking mode)
          if (delta.reasoning_content != null) {
            if (!isActiveReasoning) {
              controller.enqueue({ type: 'reasoning-start', id: '0' });
              isActiveReasoning = true;
            }
            controller.enqueue({
              type: 'reasoning-delta',
              id: '0',
              delta: delta.reasoning_content,
            });
          }

          // Handle text content
          if (delta.content != null) {
            if (!isActiveText) {
              controller.enqueue({ type: 'text-start', id: '0' });
              isActiveText = true;
            }
            controller.enqueue({
              type: 'text-delta',
              id: '0',
              delta: delta.content,
            });
          }

          // Handle tool calls
          if (delta.tool_calls != null) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;

              if (toolCalls.get(index) == null) {
                // New tool call
                controller.enqueue({
                  type: 'tool-input-start',
                  id: toolCallDelta.id ?? generateId(),
                  toolName: toolCallDelta.function?.name ?? '',
                });

                toolCalls.set(index, {
                  id: toolCallDelta.id ?? generateId(),
                  name: toolCallDelta.function?.name ?? '',
                  arguments: toolCallDelta.function?.arguments ?? '',
                });

                if (toolCallDelta.function?.arguments) {
                  controller.enqueue({
                    type: 'tool-input-delta',
                    id: toolCalls.get(index)!.id,
                    delta: toolCallDelta.function.arguments,
                  });
                }

                // Check if complete (parsable JSON)
                if (isParsableJson(toolCalls.get(index)!.arguments)) {
                  controller.enqueue({
                    type: 'tool-input-end',
                    id: toolCalls.get(index)!.id,
                  });

                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: toolCalls.get(index)!.id,
                    toolName: toolCalls.get(index)!.name,
                    input: toolCalls.get(index)!.arguments,
                  });
                }
              } else {
                // Existing tool call - append arguments
                const existingCall = toolCalls.get(index)!;
                if (toolCallDelta.function?.arguments != null) {
                  existingCall.arguments += toolCallDelta.function.arguments;

                  controller.enqueue({
                    type: 'tool-input-delta',
                    id: existingCall.id,
                    delta: toolCallDelta.function.arguments,
                  });

                  // Check if complete
                  if (isParsableJson(existingCall.arguments)) {
                    controller.enqueue({
                      type: 'tool-input-end',
                      id: existingCall.id,
                    });

                    controller.enqueue({
                      type: 'tool-call',
                      toolCallId: existingCall.id,
                      toolName: existingCall.name,
                      input: existingCall.arguments,
                    });
                  }
                }
              }
            }
          }
        },

        flush(controller) {
          if (isActiveReasoning) {
            controller.enqueue({ type: 'reasoning-end', id: '0' });
          }
          if (isActiveText) {
            controller.enqueue({ type: 'text-end', id: '0' });
          }

          controller.enqueue({
            type: 'finish',
            finishReason,
            usage: convertZaiChatUsage(usage),
          });
        },
      }),
    ),
    request: { body },
    response: { headers: responseHeaders },
  };
}
```

### 6. Provider Options Schema (`zai-chat-settings.ts`)

```typescript
export const zaiChatLanguageModelOptions = lazySchema(() =>
  zodSchema(
    z.object({
      /**
       * Thinking mode configuration.
       * - 'enabled': Model will think before responding (default for GLM-4.7)
       * - 'disabled': No thinking
       */
      thinking: z
        .object({
          type: z.enum(["enabled", "disabled"]).optional(),
          clear_thinking: z.boolean().optional(),
        })
        .optional(),

      /**
       * Enable tool streaming.
       */
      tool_stream: z.boolean().optional(),

      /**
       * Web search configuration.
       */
      web_search: z
        .object({
          enable: z.boolean(),
          search_query: z.string().optional(),
          search_result: z.boolean().optional(),
          require_search: z.boolean().optional(),
          search_domain_filter: z.string().optional(),
          search_recency_filter: z
            .enum(["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"])
            .optional(),
          content_size: z.enum(["medium", "high"]).optional(),
          result_sequence: z.enum(["before", "after"]).optional(),
        })
        .optional(),

      /**
       * Retrieval tool configuration.
       */
      retrieval: z
        .object({
          knowledge_id: z.string(),
          prompt_template: z.string().optional(),
        })
        .optional(),

      /**
       * Pass-through request fields supported by Z.ai.
       */
      request_id: z.string().optional(),
      user_id: z.string().optional(),
      seed: z.number().int().optional(),
      do_sample: z.boolean().optional(),
      meta: z.record(z.string()).optional(),
      sensitive_word_check: z
        .object({
          type: z.string().optional(),
          status: z.string().optional(),
        })
        .optional(),
      watermark_enabled: z.boolean().optional(),
      extra: z.record(z.any()).optional(),
    })
  )
);
```

### 7. Tool Preparation (`zai-chat-prepare-tools.ts`)

```typescript
export function prepareChatTools({
  tools,
  toolChoice,
}: {
  tools?: LanguageModelV3CallOptions["tools"];
  toolChoice?: LanguageModelV3ToolChoice;
}): {
  tools: ZaiTool[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  warnings: SharedV3Warning[];
} {
  const warnings: SharedV3Warning[] = [];
  const zaiTools: ZaiTool[] = [];

  // Handle function tools
  for (const tool of tools ?? []) {
    if (tool.type === "function") {
      zaiTools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      });
    } else if (tool.type === "provider") {
      // Handle provider tools (web_search, retrieval)
      switch (tool.id ?? tool.name) {
        case "zai.web_search":
        case "web_search":
          zaiTools.push({
            type: "web_search",
            web_search: tool.args as ZaiTool["web_search"],
          });
          break;
        case "zai.retrieval":
        case "retrieval":
          zaiTools.push({
            type: "retrieval",
            retrieval: tool.args as ZaiTool["retrieval"],
          });
          break;
        default:
          warnings.push({
            type: "unsupported",
            feature: `provider tool: ${tool.id ?? tool.name}`,
          });
      }
    }
  }

  // Pass through toolChoice when possible (Z.ai accepts string or explicit tool selection)
  const zaiToolChoice =
    toolChoice == null
      ? undefined
      : toolChoice.type === "tool"
        ? { type: "function", function: { name: toolChoice.toolName } }
        : toolChoice.type;

  return { tools: zaiTools, toolChoice: zaiToolChoice, warnings };
}
```

### 8. Model Capabilities (`zai-language-model-capabilities.ts`)

```typescript
export function getZaiLanguageModelCapabilities(modelId: string) {
  const isVisionModel = modelId.includes("v") || modelId.includes("vision");
  const isLatestModel = modelId.startsWith("glm-4.7") || modelId.startsWith("glm-4.6");

  return {
    isVisionModel,
    supportsToolStreaming: true,
    supportsThinking: modelId.startsWith("glm-4.7") || modelId.startsWith("glm-4.6"),
    defaultThinkingEnabled: modelId.startsWith("glm-4.7"),
    supportsWebSearch: true,
    supportsRetrieval: true,
    supportsJsonOutput: true,
  };
}
```

---

## Testing Strategy

### Unit Tests

1. **Message Conversion Tests**
   - System messages
   - User messages (text and multimodal)
   - Assistant messages (text, reasoning, tool calls)
   - Tool result messages
   - Preserved thinking propagation
   - Image data URL normalization (strip `data:image/*;base64,`)

2. **Response Mapping Tests**
   - Text responses
   - Reasoning content
   - Tool calls
   - Web search results
   - Usage mapping to `inputTokens`/`outputTokens`
   - Finish reasons

3. **Streaming Tests**
   - Text streaming
   - Reasoning streaming
   - Tool call streaming
   - Multi-turn tool calls
   - Error handling
   - Response metadata stream part

4. **Tool Preparation Tests**
   - Function tools
   - Web search tool
   - Retrieval tool
   - Tool choice pass-through
   - Temperature/top_p clamping + do_sample toggling

### Integration Tests

```typescript
// Example test structure
describe("ZaiChatLanguageModel", () => {
  it("should generate text", async () => {
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: "Hello" }],
    });
    expect(result.content[0].type).toBe("text");
  });

  it("should stream text", async () => {
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: "Hello" }],
    });

    const chunks = await readStream(stream);
    expect(chunks.some(c => c.type === "text-delta")).toBe(true);
  });

  it("should support function calling", async () => {
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: "What is the weather?" }],
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
    });
    expect(result.content.some(c => c.type === "tool-call")).toBe(true);
  });

  it("should support thinking mode", async () => {
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: "Solve: 2+2" }],
      providerOptions: {
        zai: { thinking: { type: "enabled" } },
      },
    });
    expect(result.content.some(c => c.type === "reasoning")).toBe(true);
  });
});
```

### Example Applications

Create examples demonstrating:

1. Basic chat completion
2. Streaming responses
3. Function calling
4. Thinking modes
5. Web search
6. Multimodal (images)
7. JSON mode

---

## Documentation

### README.md Structure

```markdown
# @ai-sdk/zai

Z.ai provider for the [Vercel AI SDK](https://sdk.vercel.ai).

## Installation

\`\`\`bash
npm install @ai-sdk/zai
\`\`\`

## Usage

\`\`\`typescript
import { generateText, streamText } from 'ai';
import { createZai } from '@ai-sdk/zai';

const zai = createZai({
apiKey: process.env.ZAI_API_KEY,
endpoint: 'general', // or 'coding'
});

// Basic generation
const { text } = await generateText({
model: zai('glm-4.7'),
prompt: 'Hello, Z.ai!',
});

// Streaming
const { textStream } = await streamText({
model: zai('glm-4.7'),
prompt: 'Tell me a story',
});

// Function calling
const { text, toolCalls } = await generateText({
model: zai('glm-4.7'),
tools: {
getWeather: {
description: 'Get weather for a city',
parameters: z.object({
city: z.string(),
}),
},
},
toolChoice: 'auto',
prompt: 'What is the weather in Beijing?',
});

// Thinking mode
const { text } = await generateText({
model: zai('glm-4.7'),
providerOptions: {
zai: {
thinking: { type: 'enabled', clear_thinking: false },
},
},
prompt: 'Solve this complex problem...',
});

// Web search
const { text } = await generateText({
model: zai('glm-4.7'),
tools: [{
type: 'provider',
id: 'zai.web_search',
name: 'web_search',
args: {
enable: true,
search_recency_filter: 'oneWeek',
},
}],
prompt: 'What are the latest AI developments?',
});

// JSON mode
const { object } = await generateObject({
model: zai('glm-4.7'),
schema: z.object({
name: z.string(),
age: z.number(),
}),
prompt: 'Extract info from: John is 30 years old',
});

// Vision (GLM-4.6v)
const { text } = await generateText({
model: zai.chat('glm-4.6v'),
prompt: [
{
role: 'user',
content: [
{ type: 'text', text: 'What do you see?' },
{ type: 'file', mediaType: 'image/png', data: base64Image },
],
},
],
});
\`\`\`

## Usage Guide

Add a short, task‑oriented guide section in the README after the main Usage example.

### 1) Quick Start

\`\`\`typescript
import { generateText } from 'ai';
import { createZai } from '@ai-sdk/zai';

const zai = createZai({
apiKey: process.env.ZAI_API_KEY,
endpoint: 'general', // or 'coding'
});

const { text } = await generateText({
model: zai('glm-4.7'),
prompt: 'Hello, Z.ai!',
});
\`\`\`

### 2) Coding Endpoint

\`\`\`typescript
const zai = createZai({
apiKey: process.env.ZAI_API_KEY,
endpoint: 'coding',
});
\`\`\`

### 3) Thinking Mode (Reasoning)

\`\`\`typescript
const { text } = await generateText({
model: zai('glm-4.7'),
prompt: 'Solve this step by step...',
providerOptions: {
zai: { thinking: { type: 'enabled', clear_thinking: false } },
},
});
\`\`\`

### 4) Tool Calling + Tool Streaming

\`\`\`typescript
const { toolCalls } = await generateText({
model: zai('glm-4.7'),
prompt: 'What is the weather in Beijing?',
tools: {
get_weather: {
description: 'Get weather for a city',
parameters: z.object({ city: z.string() }),
},
},
providerOptions: {
zai: { tool_stream: true },
},
});
\`\`\`

### 5) Web Search

\`\`\`typescript
const { text, sources } = await generateText({
model: zai('glm-4.7'),
prompt: 'Latest AI news',
tools: [{
type: 'provider',
id: 'zai.web_search',
name: 'web_search',
args: { enable: true, search_result: true },
}],
});
\`\`\`

### 6) JSON Mode

\`\`\`typescript
const { object } = await generateObject({
model: zai('glm-4.7'),
schema: z.object({ name: z.string(), age: z.number() }),
prompt: 'Extract: John is 30',
});
\`\`\`

### 7) Vision (Images)

\`\`\`typescript
const { text } = await generateText({
model: zai('glm-4.6v'),
prompt: [
{
role: 'user',
content: [
{ type: 'text', text: 'What is in this image?' },
{ type: 'file', mediaType: 'image/png', data: base64Image },
],
},
],
});
\`\`\`

### 8) Environment Variables

\`\`\`bash
ZAI_API_KEY=...
ZAI_BASE_URL=... # optional override
\`\`\`

## Models

- \`glm-4.7\` - Latest flagship model with thinking enabled
- \`glm-4.7-flash\` - Faster variant
- \`glm-4.6\` - General chat model
- \`glm-4.6v\` - Vision model
- \`glm-4.5\` - Basic support
- \`glm-4.5v\` - Vision model
- \`autoglm-phone-multilingual\` - Mobile assistant

## Provider Options

### \`thinking\`

\`\`\`typescript
providerOptions: {
zai: {
thinking: {
type: 'enabled' | 'disabled',
clear_thinking: boolean, // false for preserved thinking
},
},
}
\`\`\`

### \`tool_stream\`

\`\`\`typescript
providerOptions: {
zai: {
tool_stream: true,
},
}
\`\`\`

### \`web_search\`

\`\`\`typescript
tools: [{
type: 'provider',
id: 'zai.web_search',
name: 'web_search',
args: {
enable: true,
search_recency_filter: 'oneWeek',
content_size: 'high',
result_sequence: 'after',
},
}]
\`\`\`

## Capabilities

| Feature            | Support       |
| ------------------ | ------------- |
| Text generation    | ✅            |
| Streaming          | ✅            |
| Function calling   | ✅            |
| Thinking modes     | ✅            |
| Preserved thinking | ✅            |
| Web search         | ✅            |
| Retrieval          | ✅            |
| JSON mode          | ✅            |
| Vision (images)    | ✅            |
| Vision (video)     | ⚠️ Unverified |
| File upload (PDF)  | ⚠️ Unverified |
| Tool streaming     | ✅            |

## Configuration

\`\`\`typescript
import { createZai } from '@ai-sdk/zai';

const zai = createZai({
endpoint: 'general', // or 'coding'
baseURL: 'https://api.z.ai/api/paas/v4', // optional override
apiKey: process.env.ZAI_API_KEY, // from env var or explicit
sourceChannel: 'typescript-sdk', // x-source-channel header
headers: {
// Custom headers
},
fetch: customFetch, // Optional custom fetch
});
\`\`\`

## License

MIT
\`\`\`
```

---

## Implementation Checklist

### Phase 1: Core Implementation

- [ ] Package structure setup
- [ ] `zai-provider.ts` - Provider factory
- [ ] `zai-error.ts` - Error handling
- [ ] `zai-constants.ts` - Constants
- [ ] `version.ts` - Version management
- [ ] `package.json` configuration
- [ ] `tsconfig.json` configuration

### Phase 2: Chat Model

- [ ] `zai-chat-language-model.ts` - Main class
- [ ] `zai-chat-api.ts` - API schemas
- [ ] `zai-chat-settings.ts` - Provider options
- [ ] `zai-chat-prompt.ts` - Prompt types
- [ ] `convert-to-zai-chat-messages.ts` - Message conversion
- [ ] `map-zai-chat-response.ts` - Response mapping

### Phase 3: Tools

- [ ] `zai-chat-prepare-tools.ts` - Tool preparation
- [ ] `zai-language-model-capabilities.ts` - Model capabilities
- [ ] Web search tool support
- [ ] Retrieval tool support
- [ ] Function calling tests

### Phase 4: Streaming

- [ ] `doStream()` implementation
- [ ] Reasoning streaming
- [ ] Tool call streaming
- [ ] `tool_stream` support
- [ ] TransformStream error handling

### Phase 5: Advanced Features

- [ ] Thinking mode support (interleaved, preserved, turn-level)
- [ ] Context caching (clear_thinking: false)
- [ ] JSON mode (response_format)
- [ ] Vision/multimodal support
- [ ] File upload support

### Phase 6: Testing

- [ ] Unit tests for message conversion
- [ ] Unit tests for response mapping
- [ ] Unit tests for streaming
- [ ] Unit tests for tools
- [ ] Integration tests
- [ ] Example applications

### Phase 7: Documentation

- [ ] README.md
- [ ] API documentation
- [ ] Examples
- [ ] CHANGELOG.md

### Phase 8: Hybrid Agent (Provider-Agnostic Smart Context Management)

**Purpose**: Seamless image handling with intelligent intent detection and specialized prompt routing, while preserving full conversation context and streaming partial vision analysis to the user.

#### Problem Statement

When users paste images in AI SDK applications:

1. **Text models** (`glm-4.7`, `glm-4.6`) cannot process image parts.
2. **Vision models** (`glm-4.6v`, `glm-4.5v`) degrade with long, text-heavy history.
3. **Specialized prompts** from MCP server (ui-to-artifact, error-diagnosis, etc.) are lost.
4. **Manual tool selection** interrupts natural conversation flow.

#### Solution Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   PROVIDER-AGNOSTIC HYBRID AGENT                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1) ANALYZE CONTEXT (glm-4.7 full context)                                │
│     - detect images, summarize intent cues                               │
│                                                                           │
│  2) INTENT CLASSIFICATION (glm-4.7)                                       │
│     - choose specialized prompt                                           │
│                                                                           │
│  3) VISION ANALYSIS (glm-4.6v minimal context)                            │
│     - stream partial analysis to user                                    │
│     - buffer full analysis internally                                    │
│                                                                           │
│  4) INJECT + CONTINUE (glm-4.7 full context, no images)                   │
│     - insert vision analysis into prompt                                 │
│     - stream final response to user                                      │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Key Decisions (to avoid common mistakes)

- **Implements `LanguageModelV3`** (AI SDK v6 shape) with `doGenerate`/`doStream`.
- **Vision output is injected into the prompt**, then the text model produces the final answer.
- **Image parts are stripped** before calling the text model (it cannot handle `file` parts).
- **Prompts are loaded synchronously**; on failure, return a plain error message and stop.
- **Partial vision analysis is streamed** to the user while buffering the full analysis for injection.
- **Multi-image is supported** with strategy-based execution (compare vs independent).
- **Provider-agnostic core**: the agent takes `LanguageModelV3` instances (text + vision) and optional adapter hooks for provider quirks (image normalization, streaming behavior, etc.).

#### Provider-Agnostic Design

Use dependency injection so the hybrid agent works with any provider that implements `LanguageModelV3`. Only provider-specific details live in an adapter layer.

Core requirements:

- Accept `textModel` and `visionModel` instances (or a factory that returns them).
- Keep prompts in AI SDK v6 shapes; providers handle their own wire format.
- Optional adapter hooks for provider-specific quirks (example: Z.ai image data URL stripping).
- Graceful fallback when vision streaming is unsupported (run non-stream vision, then stream text model).

#### File Structure

```
packages/core/ [existing]
├── src/ [existing]
│   ├── agents/ [existing]
│   │   └── hybrid-agent/ [existing]
│   │       ├── hybrid-agent.ts [existing]              # LanguageModelV3 implementation
│   │       ├── intent-classifier.ts [existing]         # Intent detection logic
│   │       ├── prompt-registry.ts [existing]           # Prompt registry + prompt sources (sync)
│   │       ├── prompts/ [existing]                     # Prompt definitions (reused from MCP server)
│   │       │   ├── ui-to-artifact.ts [existing]
│   │       │   ├── text-extraction.ts [existing]
│   │       │   ├── error-diagnosis.ts [existing]
│   │       │   ├── diagram-analysis.ts [existing]
│   │       │   ├── data-viz.ts [existing]
│   │       │   ├── ui-diff.ts [existing]
│   │       │   └── general-image.ts [existing]
│   │       ├── zai-hybrid-agent.ts [existing]          # Z.ai adapter factory
│   │       ├── vision-request-handler.ts [existing]    # Vision model calling
│   │       ├── prompt-injector.ts [existing]           # Inject vision analysis into prompt
│   │       ├── image-utils.ts [existing]               # Image detection + extraction
│   │       ├── types.ts [existing]                     # Agent-specific types
│   │       └── index.ts [existing]                     # Agent exports
│   └── index.ts [existing]                             # Public exports
├── tests/ [existing]
│   └── agents/ [existing]
│       └── hybrid-agent/ [existing]
│           ├── intent-classifier.test.ts [existing]
│           ├── vision-request.test.ts [new]
│           ├── prompt-injector.test.ts [existing]
│           └── e2e-scenarios.test.ts [new]
├── examples/ [existing]
│   └── hybrid-agent.ts [existing]
├── package.json [existing]
├── tsconfig.json [existing]
└── README.md [new]
```

#### Prompt Registry (MCP-Compatible + Extensible)

Design the prompt layer to be as extensible as the MCP server:

- **Single-prompt tools**: `text-extraction`, `error-diagnosis`, `diagram-analysis`, `data-viz`, `ui-diff`, `general-image`
- **Multi-variant tools**: `ui-to-artifact` with `output_type` variants (`code`, `prompt`, `spec`, `description`)
- **Parameterized prompts**: text-extraction can append `<language_hint>`, diagram-analysis can include `diagram_type`, data-viz can include `analysis_focus`

Use a registry that resolves a **system prompt** and **user prompt** at runtime, based on intent + params, mirroring how MCP tools pick prompts and augment user instructions.

Key idea: model prompts like MCP tools.

- Each prompt handler owns **variant selection** (e.g. `ui-to-artifact` by `output_type`)
- Each handler can **augment the user prompt** using params (language hints, diagram types, analysis focus)
- Optional **schema + metadata** mirrors MCP tool registration

MCP tool mapping (intent ids + params):

| IntentId           | MCP tool name                 | promptParams keys                 |
| ------------------ | ----------------------------- | --------------------------------- |
| `ui-to-artifact`   | `ui_to_artifact`              | `output_type`                     |
| `text-extraction`  | `extract_text_from_screenshot`| `programming_language`            |
| `error-diagnosis`  | `diagnose_error_screenshot`   | `context`                         |
| `diagram-analysis` | `understand_technical_diagram`| `diagram_type`                    |
| `data-viz`         | `analyze_data_visualization`  | `analysis_focus`                  |
| `ui-diff`          | `ui_diff_check`               | (none)                            |
| `general-image`    | `analyze_image`               | (none)                            |

```typescript
export interface PromptHandler {
  id: IntentId;
  description?: string;           // mirrors MCP tool description
  inputSchema?: unknown;          // zod or JSON schema (optional)
  keywords?: string[];            // classifier hints
  requiredMedia?: "image" | "video" | "none";
  minImages?: number;
  resolve(context: PromptContext): PromptResolution;
}

export interface PromptRegistry {
  register(handler: PromptHandler): void;
  get(id: IntentId): PromptHandler | undefined;
  list(): PromptHandler[];
  resolve(context: PromptContext): PromptResolution;
}

export function createPromptRegistry(initial: PromptHandler[] = []): PromptRegistry {
  const map = new Map(initial.map(handler => [handler.id, handler]));
  return {
    register: handler => map.set(handler.id, handler),
    get: id => map.get(id),
    list: () => Array.from(map.values()),
    resolve: context => {
      const handler = map.get(context.intentId);
      if (!handler) {
        throw new Error(`No prompt handler registered for intent: ${context.intentId}`);
      }
      return handler.resolve(context);
    },
  };
}
```

Example handlers that mirror MCP behavior:

```typescript
const uiToArtifactHandler: PromptHandler = {
  id: "ui-to-artifact",
  description: "Convert UI screenshots into code/prompts/specs/descriptions",
  resolve: ({ userText, promptParams }) => {
    const outputType = String(promptParams?.output_type ?? "code");
    const system = UI_TO_ARTIFACT_PROMPTS[outputType] ?? UI_TO_ARTIFACT_PROMPTS.code;
    const outputFormat = outputType === "code" ? "code" : "markdown";
    return { system, user: userText, outputFormat };
  },
};

const textExtractionHandler: PromptHandler = {
  id: "text-extraction",
  resolve: ({ userText, promptParams }) => {
    const lang = promptParams?.programming_language;
    const user = lang
      ? `${userText}\n\n<language_hint>The code is in ${lang}.</language_hint>`
      : userText;
    return { system: TEXT_EXTRACTION_PROMPT, user, outputFormat: "text" };
  },
};
```

#### Implementation Details

**1. Agent implements LanguageModelV3 (`hybrid-agent.ts`)**

```typescript
export class HybridAgent implements LanguageModelV3 {
  readonly specificationVersion = "v3";
  readonly modelId: string;

  private textModel: LanguageModelV3;
  private visionModel: LanguageModelV3;
  private promptRegistry: PromptRegistry;
  private intentClassifier: IntentClassifier;

  constructor(options: HybridAgentOptions) {
    this.modelId = options.modelId ?? "hybrid";
    this.textModel = options.textModel;
    this.visionModel = options.visionModel;
    this.promptRegistry = options.loadPrompts(); // sync
    this.intentClassifier = new IntentClassifier(this.textModel);
  }

  get provider(): string {
    return "hybrid";
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { images, userText, hasImages } = extractImagesAndText(
      options.prompt,
      options.normalizeImage
    );

    if (!hasImages) {
      return this.textModel.doGenerate(options);
    }

    const intent = await this.intentClassifier.classify(options.prompt);
    const visionText = await this.runVisionNonStreaming({ images, intent, userText });

    const injectedPrompt = injectVisionAnalysis({
      prompt: stripImageParts(options.prompt),
      analysis: visionText,
    });

    return this.textModel.doGenerate({ ...options, prompt: injectedPrompt });
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const { images, userText, hasImages } = extractImagesAndText(
      options.prompt,
      options.normalizeImage
    );

    if (!hasImages) {
      return this.textModel.doStream(options);
    }

    const intent = await this.intentClassifier.classify(options.prompt);

    return this.streamHybrid({
      options,
      intent,
      images,
      userText,
    });
  }
}
```

```typescript
export interface HybridAgentOptions {
  modelId?: string;
  textModel: LanguageModelV3;
  visionModel: LanguageModelV3;
  loadPrompts: () => PromptRegistry;
  normalizeImage?: (image: VisionImage) => VisionImage;
}
```

**2. Multi-image strategy (`image-utils.ts`)**

- **Compare intent (e.g. `ui-diff` or “compare”)**: single vision call with all images.
- **Independent intent**: per-image calls with concurrency limit (e.g. 3).
- Always label image outputs: `Image 1`, `Image 2`, etc.

```typescript
function selectVisionStrategy(intent: Intent, userText: string): "multi" | "per-image" {
  if (intent.id === "ui-diff" || /compare|difference|before\/after/i.test(userText)) {
    return "multi";
  }
  return "per-image";
}
```

**3. Vision call + partial streaming (buffer + emit)**

```typescript
async function streamHybrid({
  options,
  intent,
  images,
  userText,
}: {
  options: LanguageModelV3CallOptions;
  intent: Intent;
  images: VisionImage[];
  userText: string;
}): Promise<LanguageModelV3StreamResult> {
  const visionBuffer: string[] = [];

  const stream = new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      try {
        // 1) Stream vision analysis to user while buffering
        const visionStream = await runVisionStreaming({
          intent,
          images,
          userText,
        });

        let isFirstVisionChunk = true;
        for await (const part of visionStream.stream) {
          if (part.type === "text-delta") {
            const prefix = isFirstVisionChunk ? "[Vision] " : "";
            isFirstVisionChunk = false;
            visionBuffer.push(part.textDelta);
            controller.enqueue({
              type: "text-delta",
              textDelta: prefix + part.textDelta,
            });
          }
        }
        controller.enqueue({
          type: "text-delta",
          textDelta: "\n\n[Vision complete]\n\n",
        });

        // 2) Inject full vision analysis into prompt
        const analysis = visionBuffer.join("");
        const injectedPrompt = injectVisionAnalysis({
          prompt: stripImageParts(options.prompt),
          analysis,
        });

        // 3) Stream final response from text model
        const textStream = await textModel.doStream({
          ...options,
          prompt: injectedPrompt,
        });

        for await (const part of textStream.stream) {
          controller.enqueue(part);
        }
        controller.close();
      } catch (error) {
        controller.enqueue({
          type: "text-delta",
          textDelta: "Sorry, something went wrong analyzing the image.",
        });
        controller.close();
      }
    },
  });

  return { stream };
}
```

Notes:

- If the provider does not support vision streaming, fall back to a non-stream vision call, then stream the text model response.
- Do **not** force low temperature or disable thinking (per requirements).
- For user clarity, prefix the _first_ vision chunk (and optional end marker) so partial analysis is clearly labeled.

**4. Vision request handler (non-stream)**

```typescript
export class VisionRequestHandler {
  constructor(
    private visionModel: LanguageModelV3,
    private promptRegistry: PromptRegistry
  ) {}

  async execute(request: VisionRequest): Promise<string> {
    const result = await this.visionModel.doGenerate({
      prompt: buildVisionPrompt(request, this.promptRegistry),
    });

    return extractTextFromContent(result.content);
  }
}
```

**5. Types (`types.ts`)**

```typescript
export type IntentId = string;

export interface Intent {
  id: IntentId;
  confidence: number;
  reasoning?: string;
  promptParams?: Record<string, unknown>;
}

export type OutputFormat = "code" | "text" | "json" | "markdown";

export interface PromptContext {
  intentId: IntentId;
  userText: string;
  promptParams?: Record<string, unknown>;
}

export interface PromptResolution {
  system: string;
  user: string;
  outputFormat?: OutputFormat;
}

export interface PromptHandler {
  id: IntentId;
  description?: string;
  inputSchema?: unknown;
  keywords?: string[];
  requiredMedia?: "image" | "video" | "none";
  minImages?: number;
  resolve(context: PromptContext): PromptResolution;
}

export interface PromptRegistry {
  get(id: IntentId): PromptHandler | undefined;
  list(): PromptHandler[];
  register(handler: PromptHandler): void;
  resolve(context: PromptContext): PromptResolution;
}

export interface VisionImage {
  id: string;
  data: string | Uint8Array;
  mediaType: string;
}

export interface VisionRequest {
  intent: Intent;
  images: VisionImage[];
  userText: string;
}
```

#### Usage Examples (AI SDK v6 shapes)

```typescript
import { HybridAgent, buildMcpPromptRegistry } from "@ekacode/core";
import { createZai } from "@ekacode/zai";

const provider = createZai({ apiKey: process.env.ZAI_API_KEY });
const registry = buildMcpPromptRegistry(); // see adapter below

const agent = new HybridAgent({
  textModel: provider("glm-4.7"),
  visionModel: provider("glm-4.6v"),
  loadPrompts: () => registry,
  normalizeImage: image =>
    typeof image.data === "string" && image.data.startsWith("data:image/")
      ? { ...image, data: image.data.replace(/^data:image\/.*;base64,/, "") }
      : image,
});

// Or use the convenience factory:
// const agent = createZaiHybridAgent({ apiKey: process.env.ZAI_API_KEY });

// Example 1: UI Implementation (Long conversation + pasted image)
const result1 = await agent.doGenerate({
  prompt: [
    { role: "user", content: [{ type: "text", text: "I need a dashboard..." }] },
    { role: "assistant", content: [{ type: "text", text: "Sure. Any framework?" }] },
    { role: "user", content: [{ type: "text", text: "React + Tailwind" }] },
    {
      role: "user",
      content: [
        { type: "text", text: "Here is the design, implement it" },
        { type: "file", mediaType: "image/png", data: pastedImageData },
      ],
    },
  ],
});

// Example 2: Streaming with partial vision analysis
const { stream } = await agent.doStream({
  prompt: [
    {
      role: "user",
      content: [
        { type: "text", text: "Analyze this UI" },
        { type: "file", mediaType: "image/png", data: designImage },
      ],
    },
  ],
});
```

#### Z.ai Adapter Example (provider-specific wrapper)

```typescript
// packages/core/src/agents/hybrid-agent/zai-hybrid-agent.ts
import { createZai } from "@ekacode/zai";
import { HybridAgent } from "./hybrid-agent";
import { createPromptRegistry } from "./prompt-registry";
import {
  UI_TO_ARTIFACT_PROMPTS,
  TEXT_EXTRACTION_PROMPT,
  ERROR_DIAGNOSIS_PROMPT,
  DIAGRAM_UNDERSTANDING_PROMPT,
  DATA_VIZ_ANALYSIS_PROMPT,
  UI_DIFF_CHECK_PROMPT,
  GENERAL_IMAGE_ANALYSIS_PROMPT,
} from "./prompts"; // reuse MCP server prompts verbatim (see mcp-server-0.1.2/package/build/prompts)

// 1) Prompt registry that mirrors MCP tool behavior
// This imports prompts from ./prompts/ directory
export function buildMcpPromptRegistry(): PromptRegistry {
  const registry = createPromptRegistry();

  // ui_to_artifact (variants)
  registry.register({
    id: "ui-to-artifact",
    description: "Convert UI screenshots to code/prompts/specs/descriptions",
    inputSchema: {
      type: "object",
      properties: {
        output_type: { enum: ["code", "prompt", "spec", "description"] },
      },
      required: ["output_type"],
    },
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
    resolve: ({ userText, promptParams }) => {
      const lang = promptParams?.programming_language;
      const user = lang
        ? `${userText}\n\n<language_hint>The code is in ${lang}.</language_hint>`
        : userText;
      return { system: TEXT_EXTRACTION_PROMPT, user, outputFormat: "text" };
    },
  });

  // error_diagnosis
  registry.register({
    id: "error-diagnosis",
    resolve: ({ userText, promptParams }) => {
      const context = promptParams?.context;
      const user = context ? `${userText}\n\n<context>${context}</context>` : userText;
      return { system: ERROR_DIAGNOSIS_PROMPT, user, outputFormat: "markdown" };
    },
  });

  // diagram_analysis
  registry.register({
    id: "diagram-analysis",
    resolve: ({ userText, promptParams }) => {
      const diagramType = promptParams?.diagram_type;
      const user = diagramType
        ? `${userText}\n\n<diagram_type>${diagramType}</diagram_type>`
        : userText;
      return { system: DIAGRAM_UNDERSTANDING_PROMPT, user, outputFormat: "markdown" };
    },
  });

  // data_viz
  registry.register({
    id: "data-viz",
    resolve: ({ userText, promptParams }) => {
      const focus = promptParams?.analysis_focus;
      const user = focus ? `${userText}\n\n<analysis_focus>${focus}</analysis_focus>` : userText;
      return { system: DATA_VIZ_ANALYSIS_PROMPT, user, outputFormat: "markdown" };
    },
  });

  // ui_diff
  registry.register({
    id: "ui-diff",
    resolve: ({ userText }) => ({
      system: UI_DIFF_CHECK_PROMPT,
      user: userText,
      outputFormat: "markdown",
    }),
  });

  // general_image (fallback)
  registry.register({
    id: "general-image",
    resolve: ({ userText }) => ({
      system: GENERAL_IMAGE_ANALYSIS_PROMPT,
      user: userText,
      outputFormat: "markdown",
    }),
  });

  return registry;
}

// 2) Z.ai-specific factory that injects models + prompt registry
export function createZaiHybridAgent(options: {
  apiKey?: string;
  baseURL?: string;
  endpoint?: "general" | "coding";
  textModelId?: ZaiChatModelId;
  visionModelId?: ZaiChatModelId;
}) {
  const provider = createZai(options);

  return new HybridAgent({
    modelId: "zai.hybrid",
    textModel: provider(options.textModelId ?? "glm-4.7"),
    visionModel: provider(options.visionModelId ?? "glm-4.6v"),
    loadPrompts: buildMcpPromptRegistry,
    normalizeImage: image =>
      typeof image.data === "string" && image.data.startsWith("data:image/")
        ? { ...image, data: image.data.replace(/^data:image\/.*;base64,/, "") }
        : image,
  });
}
```

#### Testing Strategy

**Unit Tests**:

- Intent classification accuracy with various conversation contexts.
- Image extraction and stripping logic (text model never receives file parts).
- Multi-image strategy (compare vs independent).
- Prompt injection correctness.
- Streaming: vision partials emitted, full buffer injected, then text stream.

**Integration Tests**:

- End-to-end intent routes for each intent type.
- Multi-turn conversations with images.
- Failure behavior (prompt loading failure, vision failure).

**E2E Scenarios**:

```
Scenario 1: UI Implementation Flow
1. User discusses React dashboard requirements (5+ messages)
2. User pastes design mockup (image)
3. Agent streams partial vision analysis
4. Agent injects full analysis and streams final code response

Scenario 2: Error Resolution Flow
1. User describes debugging session
2. User pastes error screenshot
3. Agent streams partial diagnosis, then final explanation

Scenario 3: Compare Two UIs (multi-image)
1. User shares two screenshots
2. Agent uses multi-image vision call
3. Agent streams differences, then final summary
```

#### Streaming UX Guidance (Partial Vision)

- Prefix the **first** vision chunk, e.g. `[Vision] `, to clearly separate partial analysis from the final response.
- Optionally emit a short separator when vision analysis completes, e.g. `\n\n[Vision complete]\n\n`.
- Keep the buffered vision analysis **system-only** when injecting; do not echo it again as a user-visible message.

Example prefix handling:

```typescript
let isFirstVisionChunk = true;
for await (const part of visionStream.stream) {
  if (part.type === "text-delta") {
    const prefix = isFirstVisionChunk ? "[Vision] " : "";
    isFirstVisionChunk = false;
    visionBuffer.push(part.textDelta);
    controller.enqueue({
      type: "text-delta",
      textDelta: prefix + part.textDelta,
    });
  }
}
controller.enqueue({
  type: "text-delta",
  textDelta: "\n\n[Vision complete]\n\n",
});
```

#### Appendix: Helper Signatures (Concrete)

```typescript
// image-utils.ts
export function extractImagesAndText(prompt: LanguageModelV3Prompt): {
  hasImages: boolean;
  images: VisionImage[];
  userText: string;
};

export function stripImageParts(prompt: LanguageModelV3Prompt): LanguageModelV3Prompt;

export function selectVisionStrategy(intent: Intent, userText: string): "multi" | "per-image";

// prompt-injector.ts
export function injectVisionAnalysis(args: {
  prompt: LanguageModelV3Prompt;
  analysis: string;
}): LanguageModelV3Prompt;

// vision-request-handler.ts
export function buildVisionPrompt(
  request: VisionRequest,
  prompts: PromptRegistry
): LanguageModelV3Prompt;

// example shape
// const { system, user } = prompts.resolve({
//   intentId: request.intent.id,
//   userText: request.userText,
//   promptParams: request.intent.promptParams,
// });
// return [
//   { role: "system", content: system },
//   { role: "user", content: [...imageParts, { type: "text", text: user }] },
// ];

export function extractTextFromContent(content: LanguageModelV3Content): string;
```

#### Agent Package Exports

```typescript
// packages/core/src/index.ts
export * from "./agents/hybrid-agent";

// packages/core/src/agents/hybrid-agent/index.ts
export { HybridAgent } from "./hybrid-agent";
export { createPromptRegistry } from "./prompt-registry";
export { createZaiHybridAgent, buildMcpPromptRegistry } from "./zai-hybrid-agent";
export { IntentClassifier } from "./intent-classifier";
export type {
  HybridAgentOptions,
  Intent,
  VisionRequest,
  VisionImage,
  PromptRegistry,
  PromptHandler,
} from "./types";
```

#### Key Benefits

| Aspect                  | Traditional Provider   | MCP Server             | Ekacode Agent                     |
| ----------------------- | ---------------------- | ---------------------- | --------------------------------- |
| **Context awareness**   | ❌ Can't handle images | ❌ Each call isolated  | ✅ Full conversation history      |
| **Specialized prompts** | ❌ Generic only        | ✅ Per-tool prompts    | ✅ Same prompts preserved         |
| **Intent detection**    | N/A                    | ❌ User must pick tool | ✅ Auto-detected                  |
| **Image pasting**       | ❌ Model fails         | ❌ Requires file paths | ✅ Paste works                    |
| **Streaming UX**        | ❌ N/A                 | ❌ N/A                 | ✅ Vision partials + final stream |
| **Follow-up questions** | N/A                    | ❌ Context lost        | ✅ Full history preserved         |

#### Checklist

- [ ] Agent structure setup (`packages/core/src/agents/`)
- [ ] `hybrid-agent.ts` - LanguageModelV3 implementation
- [ ] `intent-classifier.ts` - Intent detection
- [ ] `prompt-registry.ts` - Prompt registry
- [ ] `zai-hybrid-agent.ts` - Z.ai adapter factory
- [ ] `vision-request-handler.ts` - Vision API calls
- [ ] `prompt-injector.ts` - Inject vision analysis
- [ ] `image-utils.ts` - Image extraction + strategy
- [ ] `types.ts` - Type definitions
- [ ] `index.ts` - Agent exports
- [ ] Unit tests for all components (`tests/agents/`)
- [ ] Integration tests for each intent
- [ ] E2E scenario tests
- [ ] Documentation and examples
- [ ] README.md for ekacode package

---

## Notes

### Important Implementation Details

1. **Preserved Thinking**: When `clear_thinking: false`, you MUST return the complete `reasoning_content` from previous assistant turns back to the API. The content must be exactly matching the original sequence.

2. **Tool Streaming**: Supported by the API without model gating in the official SDK; do not hard-restrict to GLM-4.6.

3. **Web Search**: Results may appear in `response.web_search` (when present, map to `source` content parts). Keep handling tolerant of missing fields.

4. **Vision Models**: Use `glm-4.6v` or `glm-4.5v` for multimodal inputs. Convert images to base64 data URLs, then strip the `data:image/*;base64,` prefix before sending.

5. **API Key**: Uses `ZAI_API_KEY` environment variable by default. Support optional JWT signing when API key is in `api_key.secret` format.

6. **Tool Choice**: The official SDK accepts string or explicit tool selection. Pass through rather than forcing `'auto'`.

7. **Thinking Default**: GLM-4.7 has thinking enabled by default (different from GLM-4.6).

8. **Headers**: Add `x-source-channel` and `Accept-Language: en-US,en` by default, with user override.

9. **Endpoints**: Support the Coding endpoint (`https://api.z.ai/api/coding/paas/v4`) via a convenience flag; allow baseURL override and the China endpoint (`https://open.bigmodel.cn/api/paas/v4`).

10. **Timeouts**: Default timeout should be generous (Python SDK uses ~300s); recommend higher timeout when thinking is enabled.

11. **Usage Details**: Map Z.ai usage into `LanguageModelV3Usage` (`inputTokens`/`outputTokens`) and include the raw usage object.

12. **AI SDK v6 shapes**: File parts use `mediaType` + `data`, tool schemas use `inputSchema`, and `toolChoice` is an object `{ type: 'auto' | 'none' | 'required' | 'tool' }` rather than a string.

13. **JSON parsing**: Do not use `JSON.parse` in provider code. Use `isParsableJson` for completion detection and `parseJSON`/`safeParseJSON` only when strictly required.

### Testing Commands

```bash
# From packages/zai
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm build             # Build
pnpm build:watch       # Build with watch
```

### Publishing

```bash
# From root
pnpm changeset         # Create changeset
pnpm changeset version # Version bump
pnpm publish           # Publish to npm
```

---

## References

- [Z.ai API Documentation](https://docs.z.ai/llms.txt)
- [Vercel AI SDK Docs](https://ai.sdk.vercel.sh)
- [Provider Contributing Guide](../../contributing/add-new-provider.md)
- [OpenAI Provider Implementation](../openai/src)
