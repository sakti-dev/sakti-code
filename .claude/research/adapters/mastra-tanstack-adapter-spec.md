# Mastra ↔ TanStack AI Adapter Specification

This document defines a concrete, implementation-ready spec for a TanStack AI adapter backed by Mastra’s `ModelRouterLanguageModel` and models.dev registry. It focuses on correctness, edge cases, and compatibility with TanStack’s stream protocol.

## 1. Scope

- Provide a `MastraTextAdapter` implementing TanStack AI’s `BaseTextAdapter`.
- Use Mastra’s `ModelRouterLanguageModel` as the single backend interface.
- Support streaming text, tool calls, and structured outputs.
- Ensure TanStack `StreamChunk` protocol correctness and tool approval flow.

## 2. Public API

### Package

`@tanstack-ai-mastra`

### Exports

- `MastraTextAdapter`
- `mastraText(modelId, config?)`
- `MastraTextProviderOptions`
- `convertToAISDKMessages()`
- `convertToolsToAISDK()`

### Types

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

## 3. Adapter Contract

### Class and Factory Signatures

```ts
export class MastraTextAdapter extends BaseTextAdapter<
  MastraTextModelId,
  MastraTextProviderOptions,
  MastraInputModalities,
  MastraMessageMetadataByModality
> {
  readonly kind: "text";
  readonly name: "mastra";

  constructor(config: MastraTextProviderOptions, modelId: MastraTextModelId);

  chatStream(options: TextOptions<MastraTextProviderOptions>): AsyncIterable<StreamChunk>;

  structuredOutput(
    options: StructuredOutputOptions<MastraTextProviderOptions>
  ): Promise<StructuredOutputResult<unknown>>;
}

export function mastraText<TModel extends MastraTextModelId>(
  modelId: TModel,
  config?: MastraTextProviderOptions
): MastraTextAdapter;
```

### Helper Signatures

```ts
export function convertToAISDKMessages(messages: Array<ModelMessage>): Array<CoreMessage>;

export function convertToolsToAISDK(
  tools: Array<Tool>
): Array<{ type: "function"; name: string; description?: string; parameters?: JSONSchema }>;

export function toContentChunk(input: {
  id: string;
  model: string;
  timestamp: number;
  delta: string;
  content: string;
}): ContentStreamChunk;

export function toToolCallChunk(input: {
  id: string;
  model: string;
  timestamp: number;
  toolCallId: string;
  name: string;
  arguments: string;
  index: number;
}): ToolCallStreamChunk;

export function toToolResultChunk(input: {
  id: string;
  model: string;
  timestamp: number;
  toolCallId: string;
  content: string;
}): ToolResultStreamChunk;

export function toDoneChunk(input: {
  id: string;
  model: string;
  timestamp: number;
  finishReason: "stop" | "length" | "content_filter" | "tool_calls" | null;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}): DoneStreamChunk;
```

### `chatStream(options: TextOptions)`

**Must** return TanStack `StreamChunk` objects with required fields:

- `id`: stable per response when possible.
- `model`: provider model name from stream metadata if provided, else `options.model`.
- `timestamp`: single timestamp per stream instance.

### `structuredOutput(options: StructuredOutputOptions)`

- `outputSchema` is already JSON Schema.
- Use provider-native structured output if available.
- Otherwise fallback to strict JSON instruction with resilient JSON parsing.
- Always return `{ data, rawText }`; never throw without yielding context (wrap in a descriptive error).

## 4. Conversion Rules

### Message Conversion (TanStack → AI SDK)

- `ModelMessage.role` maps to AI SDK `CoreMessage`.
- `content` conversions:
  - `string` → `{ type: 'text', text }`
  - `text` part → `{ type: 'text', text }`
  - `image` part → `{ type: 'image', image: source.value }`
  - `audio` part → `{ type: 'audio', audio: source.value }`
  - `video` part → `{ type: 'video', video: source.value }`
  - `document` part → `{ type: 'file', file: source.value, mimeType }`
- `role: 'tool'` maps to AI SDK tool result messages with `toolCallId`.
- Assistant tool calls map to AI SDK function-call message parts with JSON-stringified arguments.
- If `message.content` is `null`, emit an empty `text` part to avoid provider validation errors.

### Tool Execution Loop Compatibility

- For TanStack’s internal tool loop, tool calls and results must be represented as `ModelMessage` entries with:
  - `role: 'assistant'` + `toolCalls` for tool invocation
  - `role: 'tool'` + `toolCallId` + `content` for tool output
- Ensure tool output is stringified when provider requires string content.

### Tool Conversion (TanStack → AI SDK)

- Convert TanStack `Tool` to AI SDK tool schema:
  - `name`, `description`, `inputSchema` → JSON Schema
- Normalize tool names to provider requirements (e.g., lowercasing when needed).
- If `needsApproval` is true, adapter must emit `approval-requested` chunks before executing.

## 5. Stream Event Mapping

### AI SDK → TanStack `StreamChunk`

| AI SDK Event Type               | TanStack Chunk | Notes                             |
| ------------------------------- | -------------- | --------------------------------- |
| `text-delta`                    | `content`      | `delta` + cumulative `content`    |
| `reasoning-delta`               | `thinking`     | `delta` + cumulative `content`    |
| `tool-call`                     | `tool_call`    | emit `{ id, name, arguments }`    |
| `tool-result`                   | `tool_result`  | `toolCallId` + serialized content |
| `error`                         | `error`        | map message + code                |
| `finish` / `response.completed` | `done`         | include `finishReason` + `usage`  |

### Required Stream Fields

Each emitted `StreamChunk` must include:

- `id`, `model`, `timestamp`
- `content`/`delta` for `content` or `thinking` chunks
- `toolCall` fields for `tool_call`
- `toolCallId` for `tool_result`
- `finishReason` + `usage` for `done`

### Chunk Id/Model Resolution Rules

- Prefer response IDs in stream metadata when provided by the provider.
- Fall back to a generated ID `mastra-${Date.now()}-${random}`.
- Use `options.model` as the fallback model name.

## 6. Edge Cases (Mandatory Behavior)

1. **Partial tool arguments**
   - Buffer args per `toolCallId` until complete; only emit full `tool_call`.

2. **Tool call ordering**
   - Preserve original index ordering even if text interleaves.

3. **Missing finish reason**
   - Default to `stop`.

4. **Approval flow**
   - When `needsApproval` tools exist: emit `approval-requested` chunk, pause execution until approval is returned. If denied, emit `tool_result` with error state and continue safely.

5. **Structured output fallback**
   - Prefer provider-native schema (`json_schema` or equivalent).
   - Fallback: prepend schema instructions, parse JSON with tolerant extraction.

6. **Modalities mismatch**
   - TanStack uses `document`, models.dev uses `pdf`; map `pdf` → `document`.

7. **Abort handling**
   - Respect `options.request.signal` or `options.abortController.signal` and pass to Mastra call.

8. **Error wrapping**
   - Yield `error` chunk before throwing; only throw when irrecoverable.

9. **Usage accounting**
   - Map provider usage keys to `promptTokens`, `completionTokens`, `totalTokens`.

## 7. Structured Output Strategy

1. If provider supports native JSON schema output:
   - Send JSON schema directly.
2. If unsupported:
   - Inject system message with JSON schema and enforce JSON-only response.
   - Parse response with:
     - direct `JSON.parse`
     - code block extraction fallback

## 8. Pseudocode (Core Path)

```ts
async *chatStream(options) {
  const timestamp = Date.now()
  const id = genId()
  const toolBuffers = new Map()
  const responseModel = options.model

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
        yield toContentChunk({
          id,
          model: responseModel,
          timestamp,
          delta: event.text,
          content: event.content,
        })
        break
      case 'tool-call':
        bufferToolArgs(toolBuffers, event)
        if (toolArgsComplete(event)) {
          yield toToolCallChunk({
            id,
            model: responseModel,
            timestamp,
            toolCallId: event.toolCallId,
            name: event.toolName,
            arguments: event.args,
            index: event.index ?? 0,
          })
        }
        break
      case 'tool-result':
        yield toToolResultChunk({
          id,
          model: responseModel,
          timestamp,
          toolCallId: event.toolCallId,
          content: JSON.stringify(event.result),
        })
        break
      case 'error':
        yield toErrorChunk({
          id,
          model: responseModel,
          timestamp,
          error: { message: event.error?.message ?? 'Unknown error' },
        })
        break
      case 'finish':
        yield toDoneChunk({
          id,
          model: responseModel,
          timestamp,
          finishReason: event.finishReason ?? 'stop',
          usage: event.usage,
        })
        break
    }
  }
}
```

## 9. Test Matrix

- **Streaming**: text-only prompt, asserts `content` + `done`.
- **Tool call**: single tool call, asserts `tool_call` + `tool_result`.
- **Tool approval**: `needsApproval` tool, deny path.
- **Structured output**: nested JSON schema, parse success.
- **Multimodal**: image + document payload.
- **Abort**: abort mid-stream with clean termination.
- **Provider fallback**: OpenAI-compatible models.dev provider.

## 10. Reference Implementation Constraints

- Keep adapter logic stateless except for per-stream buffers.
- Avoid provider-specific behavior in adapter unless required (prefer Mastra config).
- Keep conversion utilities pure and independently testable.

---

## 11. Detailed Implementation: Message Format Conversion (Gap 1)

### 11.1 TanStack → AI SDK Message Conversion

The message conversion must handle all TanStack `ModelMessage` types and transform them into AI SDK `CoreMessage` format.

**Reference:** `@tanstack-ai/openai/src/adapters/text.ts:572-660`

```typescript
/**
 * Convert TanStack AI ModelMessage to AI SDK CoreMessage format
 *
 * This function handles all message types:
 * - user messages with multimodal content (text, image, audio, video, document)
 * - assistant messages with tool calls
 * - tool result messages with toolCallId
 *
 * Reference implementation: OpenAI adapter's convertMessagesToInput
 */
export function convertToAISDKMessages(messages: Array<ModelMessage>): Array<CoreMessage> {
  const result: Array<CoreMessage> = [];

  for (const message of messages) {
    switch (message.role) {
      case "tool":
        // Tool result message
        result.push({
          role: "tool",
          content:
            typeof message.content === "string" ? message.content : JSON.stringify(message.content),
          toolCallId: message.toolCallId!,
        });
        break;

      case "assistant":
        // Assistant message - may contain tool calls
        if (message.toolCalls && message.toolCalls.length > 0) {
          // Tool calls in assistant message
          for (const toolCall of message.toolCalls) {
            const argumentsString =
              typeof toolCall.function.arguments === "string"
                ? toolCall.function.arguments
                : JSON.stringify(toolCall.function.arguments);

            result.push({
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: toolCall.id,
                  toolName: toolCall.function.name,
                  args: argumentsString,
                },
              ],
            });
          }
        }

        // Assistant's text message (if any content)
        if (message.content) {
          const textContent = extractTextContent(message.content);
          if (textContent) {
            result.push({
              role: "assistant",
              content: textContent,
            });
          }
        }
        break;

      case "user":
        // User message with multimodal content
        const contentParts = normalizeContent(message.content);
        const aiSdkContent: Array<CoreMessage["content"]> = [];

        for (const part of contentParts) {
          aiSdkContent.push(convertContentPart(part));
        }

        // Ensure at least empty text if no content
        if (aiSdkContent.length === 0) {
          aiSdkContent.push({ type: "text", text: "" });
        }

        result.push({
          role: "user",
          content: aiSdkContent,
        });
        break;

      default:
        // Fallback for unknown roles
        result.push(message as unknown as CoreMessage);
    }
  }

  return result;
}

/**
 * Normalize message content to ContentPart array
 * Handles string, null, or ContentPart array input
 */
function normalizeContent(content: string | null | Array<ContentPart>): Array<ContentPart> {
  if (content === null) return [];
  if (typeof content === "string") {
    return [{ type: "text", content }];
  }
  return content;
}

/**
 * Extract text content from message content
 * Used for assistant messages that may be mixed content
 */
function extractTextContent(content: string | null | Array<ContentPart>): string {
  if (content === null) return "";
  if (typeof content === "string") return content;
  return content
    .filter(p => p.type === "text")
    .map(p => p.content)
    .join("");
}

/**
 * Convert a single ContentPart to AI SDK format
 */
function convertContentPart(part: ContentPart): CoreMessage["content"] {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.content };

    case "image": {
      const source = part.source;
      if (source.type === "url") {
        return { type: "image", image: source.value };
      }
      // For base64 data, construct a data URI
      return { type: "image", image: source.value };
    }

    case "audio": {
      const source = part.source;
      if (source.type === "url") {
        return { type: "audio", audio: source.value };
      }
      return { type: "audio", audio: source.value };
    }

    case "video": {
      const source = part.source;
      if (source.type === "url") {
        return { type: "video", video: source.value };
      }
      return { type: "video", video: source.value };
    }

    case "document": {
      const source = part.source;
      if (source.type === "url") {
        return {
          type: "file",
          file: source.value,
          mimeType: part.metadata?.mimeType,
        };
      }
      return {
        type: "file",
        file: source.value,
        mimeType: part.metadata?.mimeType,
      };
    }

    default:
      throw new Error(`Unsupported content part type: ${(part as { type: string }).type}`);
  }
}
```

### 11.2 Tool Schema Conversion

Convert TanStack tools to AI SDK tool format with JSON Schema:

```typescript
/**
 * Convert TanStack tools to AI SDK tool definitions
 *
 * TanStack Tool → AI SDK tool:
 * - name, description → direct copy
 * - inputSchema (Standard Schema) → JSON Schema conversion
 */
export function convertToolsToAISDK(tools: Array<Tool<any, any, any>>): Array<{
  type: "function";
  name: string;
  description?: string;
  parameters?: JSONSchema;
}> {
  return tools.map(tool => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ? convertSchemaToJsonSchema(tool.inputSchema) : undefined,
  }));
}

/**
 * Convert Standard Schema to JSON Schema
 * Handles Zod, ArkType, Valibot, and plain JSON Schema
 */
function convertSchemaToJsonSchema(schema: SchemaInput): JSONSchema {
  if (isStandardJSONSchema(schema)) {
    return schema["~standard"].jsonSchema(schema);
  }
  return schema as JSONSchema;
}
```

---

## 12. Detailed Implementation: Stream Format Compatibility (Gap 2)

### 12.1 Mastra Stream Event Types

Mastra's `createStreamFromGenerateResult` emits these event types:

| Mastra Event        | Structure                                                                        |
| ------------------- | -------------------------------------------------------------------------------- |
| `stream-start`      | `{ type: 'stream-start', warnings: unknown[] }`                                  |
| `response-metadata` | `{ type: 'response-metadata', id?: string, modelId?: string, timestamp?: Date }` |
| `text-start`        | `{ type: 'text-start', id: string }`                                             |
| `text-delta`        | `{ type: 'text-delta', id: string, delta: string }`                              |
| `text-end`          | `{ type: 'text-end', id: string }`                                               |
| `reasoning-start`   | `{ type: 'reasoning-start', id: string }`                                        |
| `reasoning-delta`   | `{ type: 'reasoning-delta', id: string, delta: string }`                         |
| `reasoning-end`     | `{ type: 'reasoning-end', id: string }`                                          |
| `tool-input-start`  | `{ type: 'tool-input-start', id: string, toolName: string }`                     |
| `tool-input-delta`  | `{ type: 'tool-input-delta', id: string, delta: unknown }`                       |
| `tool-input-end`    | `{ type: 'tool-input-end', id: string }`                                         |
| `tool-call`         | `{ type: 'tool-call', toolCallId: string, toolName: string, input: unknown }`    |
| `tool-result`       | `{ type: 'tool-result', toolCallId: string, result: unknown }`                   |
| `finish`            | `{ type: 'finish', finishReason: unknown, usage: unknown }`                      |

### 12.2 Stream Event Mapping Implementation

**Reference:** `@tanstack-ai/openai/src/adapters/text.ts:235-523`

```typescript
/**
 * Transform Mastra stream events to TanStack StreamChunk format
 *
 * Key challenges:
 * 1. Mastra emits start/delta/end events - need to accumulate content
 * 2. Tool calls have start/delta/end sequence - must buffer before emitting
 * 3. Response metadata may arrive mid-stream - update chunk metadata accordingly
 */
export async function* transformMastraStreamToTanStack(
  stream: ReadableStream,
  baseModel: string
): AsyncIterable<StreamChunk> {
  const timestamp = Date.now();
  let id: string | null = null;
  let model = baseModel;

  // Content accumulation buffers
  const textBuffers = new Map<string, string>();
  const reasoningBuffers = new Map<string, string>();

  // Tool call buffer
  const toolCallBuffer = new Map<
    string,
    {
      toolName: string;
      args: unknown;
      index: number;
    }
  >();
  let toolCallIndex = 0;

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Parse JSON if stream is binary
      const event =
        typeof value === "string" ? JSON.parse(value) : JSON.parse(decoder.decode(value));

      switch (event.type) {
        // ===== Stream Initialization =====
        case "stream-start":
          // Ignore warnings for now, could emit a warning chunk if needed
          break;

        case "response-metadata":
          id = event.id ?? id;
          model = event.modelId ?? model;
          break;

        // ===== Text Content Streaming =====
        case "text-start":
          textBuffers.set(event.id, "");
          break;

        case "text-delta":
          const currentText = textBuffers.get(event.id) ?? "";
          const newText = currentText + event.delta;
          textBuffers.set(event.id, newText);

          yield {
            type: "content",
            id: id ?? generateId(),
            model,
            timestamp,
            delta: event.delta,
            content: newText,
            role: "assistant",
          } satisfies ContentStreamChunk;
          break;

        case "text-end":
          // Text complete, buffer cleared automatically
          textBuffers.delete(event.id);
          break;

        // ===== Reasoning/Thinking Streaming =====
        case "reasoning-start":
          reasoningBuffers.set(event.id, "");
          break;

        case "reasoning-delta":
          const currentReasoning = reasoningBuffers.get(event.id) ?? "";
          const newReasoning = currentReasoning + event.delta;
          reasoningBuffers.set(event.id, newReasoning);

          yield {
            type: "thinking",
            id: id ?? generateId(),
            model,
            timestamp,
            delta: event.delta,
            content: newReasoning,
          } satisfies ThinkingStreamChunk;
          break;

        case "reasoning-end":
          reasoningBuffers.delete(event.id);
          break;

        // ===== Tool Call Streaming (Multi-Phase) =====
        case "tool-input-start":
          toolCallBuffer.set(event.id, {
            toolName: event.toolName,
            args: null!,
            index: toolCallIndex++,
          });
          break;

        case "tool-input-delta":
          const buffered = toolCallBuffer.get(event.id);
          if (buffered) {
            // For streaming arguments, accumulate delta
            // The delta might be partial JSON or complete object
            if (buffered.args === null) {
              buffered.args = event.delta;
            } else if (typeof buffered.args === "string" && typeof event.delta === "string") {
              // String concatenation for partial arguments
              buffered.args = buffered.args + event.delta;
            } else {
              // Object merge for structured deltas
              buffered.args = { ...(buffered.args as object), ...(event.delta as object) };
            }
          }
          break;

        case "tool-input-end":
          // Do NOT emit yet - wait for tool-call event
          break;

        case "tool-call":
          // NOW emit the complete tool_call
          const bufferedTool = toolCallBuffer.get(event.toolCallId);
          yield {
            type: "tool_call",
            id: id ?? generateId(),
            model,
            timestamp,
            index: bufferedTool?.index ?? 0,
            toolCall: {
              id: event.toolCallId,
              type: "function",
              function: {
                name: event.toolName,
                arguments: JSON.stringify(event.input),
              },
            },
          } satisfies ToolCallStreamChunk;
          toolCallBuffer.delete(event.toolCallId);
          break;

        case "tool-result":
          yield {
            type: "tool_result",
            id: id ?? generateId(),
            model,
            timestamp,
            toolCallId: event.toolCallId,
            content: JSON.stringify(event.result),
          } satisfies ToolResultStreamChunk;
          break;

        // ===== Stream Completion =====
        case "finish":
          const usage = mapUsage(event.usage);

          yield {
            type: "done",
            id: id ?? generateId(),
            model,
            timestamp,
            finishReason: mapFinishReason(event.finishReason),
            usage,
          } satisfies DoneStreamChunk;
          break;

        default:
          // Unknown event type - could log warning
          console.warn(
            `[MastraAdapter] Unknown stream event type: ${(event as { type: string }).type}`
          );
      }
    }
  } catch (error) {
    yield {
      type: "error",
      id: id ?? generateId(),
      model,
      timestamp,
      error: {
        message: error instanceof Error ? error.message : "Unknown stream error",
        code: error instanceof Error && "code" in error ? String(error.code) : undefined,
      },
    } satisfies ErrorStreamChunk;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Map Mastra usage to TanStack usage format
 */
function mapUsage(mastraUsage: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  if (typeof mastraUsage === "object" && mastraUsage !== null) {
    const usage = mastraUsage as Record<string, unknown>;

    // Handle various provider formats
    const promptTokens =
      typeof usage.promptTokens === "number"
        ? usage.promptTokens
        : typeof usage.input_tokens === "number"
          ? usage.input_tokens
          : typeof usage.prompt_tokens === "number"
            ? usage.prompt_tokens
            : 0;

    const completionTokens =
      typeof usage.completionTokens === "number"
        ? usage.completionTokens
        : typeof usage.output_tokens === "number"
          ? usage.output_tokens
          : typeof usage.completion_tokens === "number"
            ? usage.completion_tokens
            : 0;

    const totalTokens =
      typeof usage.totalTokens === "number"
        ? usage.totalTokens
        : typeof usage.total_tokens === "number"
          ? usage.total_tokens
          : promptTokens + completionTokens;

    return { promptTokens, completionTokens, totalTokens };
  }

  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/**
 * Map Mastra finish reason to TanStack finish reason
 */
function mapFinishReason(
  reason: unknown
): "stop" | "length" | "content_filter" | "tool_calls" | null {
  if (typeof reason === "string") {
    const normalized = reason.toLowerCase();
    if (normalized === "stop" || normalized === "end_turn") return "stop";
    if (normalized === "length" || normalized === "max_tokens") return "length";
    if (normalized === "content_filter" || normalized === "safety") return "content_filter";
    if (normalized === "tool_calls" || normalized === "tool-calls") return "tool_calls";
  }
  return "stop"; // Default fallback
}

/**
 * Generate a unique chunk ID
 */
function generateId(): string {
  return `mastra-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}
```

### 12.3 Tool Call Buffer State Machine

The tool call streaming requires careful state management:

```
tool-input-start  → Initialize buffer { toolName, args: null, index }
tool-input-delta  → Accumulate args (may be partial JSON)
tool-input-end    → Mark complete, DON'T emit yet
tool-call         → Emit complete tool_call chunk with all data
```

**Critical:** Only emit `tool_call` when receiving the `tool-call` event, not during `tool-input-end`.

### 12.4 Edge Cases in Stream Transformation

| Edge Case                             | Handling                                         |
| ------------------------------------- | ------------------------------------------------ |
| Missing response metadata             | Use generated ID and model from options          |
| Interleaved text/tool events          | Maintain separate buffers, emit in correct order |
| Partial tool arguments (JSON strings) | Accumulate as string, parse on tool-call event   |
| Malformed JSON in tool args           | Catch parse error, emit error chunk              |
| Stream abort mid-event                | Reader releaseLock in finally block              |
| Unknown event types                   | Log warning, continue stream                     |
| Missing usage data                    | Default to zero tokens                           |

### 12.5 Complete chatStream Implementation

```typescript
async *chatStream(
  options: TextOptions<MastraTextProviderOptions>
): AsyncIterable<StreamChunk> {
  const {
    messages,
    tools,
    temperature,
    maxTokens,
    topP,
    metadata,
    modelOptions,
    systemPrompts,
  } = options;

  // Convert messages to AI SDK format
  const aiSdkMessages = convertToAISDKMessages(messages);

  // Add system prompts as system message if present
  if (systemPrompts && systemPrompts.length > 0) {
    aiSdkMessages.unshift({
      role: 'system',
      content: systemPrompts.join('\n'),
    });
  }

  // Convert tools
  const aiSdkTools = tools ? convertToolsToAISDK(tools) : undefined;

  // Call Mastra's doStream
  const streamResult = await this.mastraModel.doStream({
    messages: aiSdkMessages,
    tools: aiSdkTools,
    temperature,
    maxTokens,
    topP,
    metadata,
    providerOptions: modelOptions,
    abortSignal: options.request?.signal ?? options.abortController?.signal,
  });

  // Transform and yield chunks
  yield* transformMastraStreamToTanStack(
    streamResult.stream,
    this.model
  );
}
```

---

## 13. Deep Dive: Robust Tool Call Streaming Accumulation

This section provides a comprehensive implementation of tool call streaming accumulation that handles all edge cases observed in production scenarios.

### 13.1 The Challenge

Tool call streaming in Mastra follows a multi-phase pattern:

```
tool-input-start → tool-input-delta (n times) → tool-input-end → tool-call
```

**Key challenges:**

1. Arguments are streamed incrementally - need to accumulate before emitting
2. Multiple tool calls can stream concurrently - need to track each separately
3. Text and tool calls can interleave - maintain proper ordering
4. Arguments may be partial JSON - need robust parsing
5. Stream may interrupt mid-tool-call - need cleanup

### 13.2 Tool Call State Machine

**Reference:** OpenAI adapter's pattern at `@tanstack-ai/openai/src/adapters/text.ts:431-466`

```typescript
/**
 * State machine for tracking tool call streaming lifecycle
 *
 * States: PENDING → ACCUMULATING → READY → EMITTED
 * - PENDING: tool-input-start received, waiting for deltas
 * - ACCUMULATING: receiving and accumulating tool-input-delta events
 * - READY: tool-input-end received, ready to emit
 * - EMITTED: tool-call event received, chunk emitted
 */
enum ToolCallState {
  PENDING = "pending",
  ACCUMULATING = "accumulating",
  READY = "ready",
  EMITTED = "emitted",
}

/**
 * Buffer for tracking a single tool call during streaming
 */
interface ToolCallBuffer {
  /** Current state in the lifecycle */
  state: ToolCallState;
  /** The tool name (from tool-input-start) */
  toolName: string;
  /** Accumulated arguments (may be partial JSON string) */
  args: string | Record<string, unknown>;
  /** Index for ordering (when tool_call is emitted) */
  index: number;
  /** Timestamp when tool-input-start was received */
  startTime: number;
  /** Number of delta events received */
  deltaCount: number;
}
```

### 13.3 Robust Tool Call Accumulator

```typescript
/**
 * Tool call accumulator with comprehensive state management
 *
 * Features:
 * - Tracks multiple concurrent tool calls
 * - Handles partial JSON arguments
 * - Provides debug logging for troubleshooting
 * - Cleans up stale entries
 */
class ToolCallAccumulator {
  private buffers = new Map<string, ToolCallBuffer>();
  private nextIndex = 0;
  private readonly logger?: (msg: string) => void;

  constructor(logger?: (msg: string) => void) {
    this.logger = logger;
  }

  /**
   * Initialize a new tool call buffer
   * Called when tool-input-start is received
   */
  initialize(toolCallId: string, toolName: string): void {
    if (this.buffers.has(toolCallId)) {
      this.log(`[WARN] Tool call ${toolCallId} already initialized, resetting`);
    }

    this.buffers.set(toolCallId, {
      state: ToolCallState.ACCUMULATING,
      toolName,
      args: "",
      index: this.nextIndex++,
      startTime: Date.now(),
      deltaCount: 0,
    });

    this.log(`[INIT] Tool call ${toolCallId} (${toolName}) at index ${this.nextIndex - 1}`);
  }

  /**
   * Accumulate a delta for a tool call
   * Called when tool-input-delta is received
   */
  accumulate(toolCallId: string, delta: unknown): boolean {
    const buffer = this.buffers.get(toolCallId);
    if (!buffer) {
      this.log(`[ERROR] Tool call ${toolCallId} not initialized for delta`);
      return false;
    }

    buffer.deltaCount++;

    // Handle different delta types
    if (typeof delta === "string") {
      // String delta (partial JSON)
      if (typeof buffer.args === "string") {
        buffer.args += delta;
      } else {
        // Convert to string if needed
        buffer.args = JSON.stringify(buffer.args) + delta;
      }
    } else if (typeof delta === "object" && delta !== null) {
      // Object delta (structured merge)
      if (typeof buffer.args === "string") {
        // Try to merge into existing string
        try {
          const parsed = JSON.parse(buffer.args);
          buffer.args = { ...parsed, ...(delta as Record<string, unknown>) };
        } catch {
          // Not valid JSON yet, append
          buffer.args = buffer.args + JSON.stringify(delta);
        }
      } else {
        buffer.args = {
          ...(buffer.args as Record<string, unknown>),
          ...(delta as Record<string, unknown>),
        };
      }
    } else {
      // Primitive value
      buffer.args = String(delta);
    }

    this.log(`[DELTA] Tool call ${toolCallId}: received delta #${buffer.deltaCount}`);
    return true;
  }

  /**
   * Mark tool call as ready (tool-input-end received)
   */
  markReady(toolCallId: string): void {
    const buffer = this.buffers.get(toolCallId);
    if (!buffer) {
      this.log(`[WARN] Tool call ${toolCallId} not found for ready state`);
      return;
    }

    buffer.state = ToolCallState.READY;
    const elapsed = Date.now() - buffer.startTime;
    this.log(
      `[READY] Tool call ${toolCallId} ready after ${elapsed}ms (${buffer.deltaCount} deltas)`
    );
  }

  /**
   * Get the buffered data for a tool call
   * Called when tool-call event is received
   */
  get(toolCallId: string): ToolCallBuffer | undefined {
    return this.buffers.get(toolCallId);
  }

  /**
   * Remove a tool call from buffer after emitting
   */
  remove(toolCallId: string): void {
    const existed = this.buffers.delete(toolCallId);
    if (existed) {
      this.log(`[CLEANUP] Tool call ${toolCallId} removed from buffer`);
    }
  }

  /**
   * Check if a tool call exists
   */
  has(toolCallId: string): boolean {
    return this.buffers.has(toolCallId);
  }

  /**
   * Get all pending/ready tool calls
   */
  getAllPending(): Map<string, ToolCallBuffer> {
    return new Map(
      Array.from(this.buffers.entries()).filter(([_, buf]) => buf.state !== ToolCallState.EMITTED)
    );
  }

  /**
   * Clean up stale entries (for error recovery)
   */
  cleanupStale(maxAgeMs: number = 30000): string[] {
    const now = Date.now();
    const stale: string[] = [];

    for (const [id, buffer] of this.buffers.entries()) {
      if (now - buffer.startTime > maxAgeMs) {
        stale.push(id);
        this.log(`[STALE] Tool call ${id} stale (${now - buffer.startTime}ms old), cleaning up`);
      }
    }

    for (const id of stale) {
      this.buffers.delete(id);
    }

    return stale;
  }

  /**
   * Clear all buffers (for error recovery)
   */
  clear(): void {
    const count = this.buffers.size;
    this.buffers.clear();
    this.nextIndex = 0;
    this.log(`[CLEAR] Cleared ${count} tool call buffers`);
  }

  private log(message: string): void {
    this.logger?.(`[ToolCallAccumulator] ${message}`);
  }
}
```

### 13.4 Argument Parsing with Fallbacks

```typescript
/**
 * Parse tool call arguments with multiple fallback strategies
 *
 * Handles:
 * - Valid JSON strings
 * - Partial JSON strings (still accumulating)
 * - Already-parsed objects
 * - Malformed JSON (with position info)
 */
function parseToolArguments(
  args: string | Record<string, unknown> | unknown,
  toolCallId: string
): { success: true; arguments: string } | { success: false; error: string } {
  try {
    if (typeof args === "string") {
      const trimmed = args.trim();

      // Check if it looks like JSON
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return {
          success: false,
          error: `Arguments do not appear to be JSON: "${trimmed.substring(0, 50)}..."`,
        };
      }

      // Try parsing as-is
      const parsed = JSON.parse(trimmed);
      return {
        success: true,
        arguments: JSON.stringify(parsed), // Normalize to string
      };
    } else if (typeof args === "object" && args !== null) {
      return {
        success: true,
        arguments: JSON.stringify(args),
      };
    } else {
      return {
        success: false,
        error: `Invalid arguments type: ${typeof args}`,
      };
    }
  } catch (error) {
    const err = error as Error;
    const match = err.message.match(/position (\d+)/);
    const position = match ? ` at position ${match[1]}` : "";

    return {
      success: false,
      error: `JSON parse error${position}: ${err.message}`,
    };
  }
}
```

### 13.5 Complete Stream Transformation with Tool Call Accumulation

```typescript
/**
 * Transform Mastra stream to TanStack format with robust tool call handling
 *
 * This implementation uses the ToolCallAccumulator for state management
 * and handles all edge cases in tool call streaming.
 */
export async function* transformMastraStreamToTanStackRobust(
  stream: ReadableStream,
  baseModel: string,
  options?: {
    debug?: boolean;
    onToolCallEmit?: (toolCall: ToolCallStreamChunk) => void;
    onError?: (error: ErrorStreamChunk) => void;
  }
): AsyncIterable<StreamChunk> {
  const timestamp = Date.now();
  let id: string | null = null;
  let model = baseModel;

  // Content buffers
  const textBuffers = new Map<string, string>();
  const reasoningBuffers = new Map<string, string>();

  // Tool call accumulator
  const toolAccumulator = new ToolCallAccumulator(
    options?.debug ? msg => console.log(`[MastraStream] ${msg}`) : undefined
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const event =
        typeof value === "string" ? JSON.parse(value) : JSON.parse(decoder.decode(value));

      switch (event.type) {
        // ===== Metadata =====
        case "response-metadata":
          id = event.id ?? id;
          model = event.modelId ?? model;
          break;

        // ===== Text Content =====
        case "text-start":
          textBuffers.set(event.id, "");
          break;

        case "text-delta":
          const currentText = textBuffers.get(event.id) ?? "";
          const newText = currentText + event.delta;
          textBuffers.set(event.id, newText);

          yield {
            type: "content",
            id: id ?? generateId(),
            model,
            timestamp,
            delta: event.delta,
            content: newText,
            role: "assistant",
          } satisfies ContentStreamChunk;
          break;

        case "text-end":
          textBuffers.delete(event.id);
          break;

        // ===== Reasoning =====
        case "reasoning-start":
          reasoningBuffers.set(event.id, "");
          break;

        case "reasoning-delta":
          const currentReasoning = reasoningBuffers.get(event.id) ?? "";
          const newReasoning = currentReasoning + event.delta;
          reasoningBuffers.set(event.id, newReasoning);

          yield {
            type: "thinking",
            id: id ?? generateId(),
            model,
            timestamp,
            delta: event.delta,
            content: newReasoning,
          } satisfies ThinkingStreamChunk;
          break;

        case "reasoning-end":
          reasoningBuffers.delete(event.id);
          break;

        // ===== Tool Call Streaming =====
        case "tool-input-start":
          toolAccumulator.initialize(event.id, event.toolName);
          break;

        case "tool-input-delta":
          toolAccumulator.accumulate(event.id, event.delta);
          break;

        case "tool-input-end":
          toolAccumulator.markReady(event.id);
          // IMPORTANT: Do NOT emit here - wait for tool-call event
          break;

        case "tool-call": {
          const buffered = toolAccumulator.get(event.toolCallId);

          if (!buffered) {
            // Tool call without buffer - may be from non-streaming response
            // Emit directly using event.input
            const chunk: ToolCallStreamChunk = {
              type: "tool_call",
              id: id ?? generateId(),
              model,
              timestamp,
              index: toolAccumulator["nextIndex"]++, // Get next index
              toolCall: {
                id: event.toolCallId,
                type: "function",
                function: {
                  name: event.toolName,
                  arguments: JSON.stringify(event.input),
                },
              },
            };
            options?.onToolCallEmit?.(chunk);
            yield chunk;
            break;
          }

          // Parse accumulated arguments
          const parsed = parseToolArguments(buffered.args, event.toolCallId);

          if (!parsed.success) {
            // Argument parsing failed - emit error and continue
            const errorChunk: ErrorStreamChunk = {
              type: "error",
              id: id ?? generateId(),
              model,
              timestamp,
              error: {
                message: `Failed to parse tool arguments for ${event.toolName}: ${parsed.error}`,
                code: "TOOL_ARGS_PARSE_ERROR",
              },
            };
            options?.onError?.(errorChunk);
            yield errorChunk;

            // Try to use event.input as fallback
            const fallbackChunk: ToolCallStreamChunk = {
              type: "tool_call",
              id: id ?? generateId(),
              model,
              timestamp,
              index: buffered.index,
              toolCall: {
                id: event.toolCallId,
                type: "function",
                function: {
                  name: event.toolName,
                  arguments: JSON.stringify(event.input),
                },
              },
            };
            yield fallbackChunk;
          } else {
            const chunk: ToolCallStreamChunk = {
              type: "tool_call",
              id: id ?? generateId(),
              model,
              timestamp,
              index: buffered.index,
              toolCall: {
                id: event.toolCallId,
                type: "function",
                function: {
                  name: event.toolName,
                  arguments: parsed.arguments,
                },
              },
            };
            options?.onToolCallEmit?.(chunk);
            yield chunk;
          }

          toolAccumulator.remove(event.toolCallId);
          break;
        }

        // ===== Tool Result =====
        case "tool-result":
          yield {
            type: "tool_result",
            id: id ?? generateId(),
            model,
            timestamp,
            toolCallId: event.toolCallId,
            content: JSON.stringify(event.result),
          } satisfies ToolResultStreamChunk;
          break;

        // ===== Stream Completion =====
        case "finish":
          // Clean up any stale tool calls
          const stale = toolAccumulator.cleanupStale();
          if (stale.length > 0 && options?.debug) {
            console.warn(`[MastraStream] ${stale.length} stale tool calls cleaned up at finish`);
          }

          yield {
            type: "done",
            id: id ?? generateId(),
            model,
            timestamp,
            finishReason: mapFinishReason(event.finishReason),
            usage: mapUsage(event.usage),
          } satisfies DoneStreamChunk;
          break;

        default:
          if (options?.debug) {
            console.warn(`[MastraStream] Unknown event type: ${(event as { type: string }).type}`);
          }
      }
    }
  } catch (error) {
    const errorChunk: ErrorStreamChunk = {
      type: "error",
      id: id ?? generateId(),
      model,
      timestamp,
      error: {
        message: error instanceof Error ? error.message : "Unknown stream error",
        code: error instanceof Error && "code" in error ? String(error.code) : undefined,
      },
    };
    options?.onError?.(errorChunk);
    yield errorChunk;
  } finally {
    // Clean up on stream end
    toolAccumulator.clear();
    reader.releaseLock();
  }
}
```

### 13.6 Edge Case Handling Summary

| Edge Case                    | Detection                     | Handling                                    |
| ---------------------------- | ----------------------------- | ------------------------------------------- |
| **Tool call without buffer** | `buffered === undefined`      | Use event.input directly, assign next index |
| **Partial JSON in args**     | JSON parse fails              | Use event.input fallback, emit warning      |
| **Stale tool calls**         | Time since start > 30s        | Cleanup on finish event, log warning        |
| **Missing tool-call event**  | Buffer not cleaned up         | Cleanup stale entries periodically          |
| **Malformed delta type**     | Unexpected type in accumulate | Convert to string, log debug                |
| **Concurrent tool calls**    | Multiple IDs in buffer        | Track separately by toolCallId              |
| **Interleaved text/tools**   | Mixed event types             | Maintain separate buffers, emit in order    |

### 13.7 Testing Strategy

```typescript
describe("ToolCallAccumulator", () => {
  it("should accumulate string deltas", () => {
    const acc = new ToolCallAccumulator();
    acc.initialize("tc1", "testTool");
    acc.accumulate("tc1", '{"arg');
    acc.accumulate("tc1", '1": "value1"}');
    acc.markReady("tc1");

    const buffered = acc.get("tc1");
    expect(buffered?.args).toBe('{"arg1": "value1"}');
  });

  it("should handle object deltas", () => {
    const acc = new ToolCallAccumulator();
    acc.initialize("tc1", "testTool");
    acc.accumulate("tc1", { arg1: "value1" });
    acc.accumulate("tc1", { arg2: "value2" });
    acc.markReady("tc1");

    const buffered = acc.get("tc1");
    expect(buffered?.args).toEqual({ arg1: "value1", arg2: "value2" });
  });

  it("should handle concurrent tool calls", () => {
    const acc = new ToolCallAccumulator();
    acc.initialize("tc1", "tool1");
    acc.initialize("tc2", "tool2");

    expect(acc.get("tc1")?.index).toBe(0);
    expect(acc.get("tc2")?.index).toBe(1);
  });

  it("should cleanup stale entries", () => {
    const acc = new ToolCallAccumulator();
    acc.initialize("tc1", "testTool");

    // Simulate time passing
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 35000);

    const stale = acc.cleanupStale(30000);
    expect(stale).toEqual(["tc1"]);
    expect(acc.has("tc1")).toBe(false);
  });
});
```

---

## 14. Deep Dive: Robust Structured Output Strategy (Gap 3)

This section provides a comprehensive implementation of structured output that handles all provider types and edge cases.

### 14.1 The Challenge

Structured output capabilities vary significantly across providers:

| Provider              | Native Support | Method                                            |
| --------------------- | -------------- | ------------------------------------------------- |
| **OpenAI**            | ✅ Yes         | `response_format: { type: 'json_schema' }`        |
| **Anthropic**         | ❌ No          | Tool-based forced calling                         |
| **Google Gemini**     | ✅ Yes         | `responseSchema` or `responseMimeType`            |
| **Mistral**           | ⚠️ Partial     | Tool-based or constrained decoding                |
| **OpenAI-compatible** | ❓ Varies      | May support `json_schema` via compatibility layer |
| **Ollama**            | ❌ No          | Instruction-based only                            |

**Key challenges:**

1. Provider capability detection - need to know which method to use
2. Schema transformation - each provider has different requirements
3. Fallback parsing - when native support fails
4. Error recovery - handle malformed JSON gracefully
5. Null/undefined handling - optional fields vs required fields

### 14.2 Provider Capability Detection

```typescript
/**
 * Provider structured output capabilities
 */
enum StructuredOutputSupport {
  /** Full native JSON schema support */
  NATIVE_JSON_SCHEMA = "native_json_schema",
  /** Tool-based structured output (Anthropic-style) */
  TOOL_BASED = "tool_based",
  /** Constrained decoding (Mistral-style) */
  CONSTRAINED_DECODING = "constrained_decoding",
  /** No native support - instruction based only */
  INSTRUCTION_ONLY = "instruction_only",
}

/**
 * Provider capability mapping
 * Maps provider IDs to their structured output support level
 */
const PROVIDER_CAPABILITIES: Record<string, StructuredOutputSupport> = {
  // OpenAI - native JSON schema
  openai: StructuredOutputSupport.NATIVE_JSON_SCHEMA,

  // Anthropic - tool-based only
  anthropic: StructuredOutputSupport.TOOL_BASED,

  // Google Gemini - native schema support
  google: StructuredOutputSupport.NATIVE_JSON_SCHEMA,
  gemini: StructuredOutputSupport.NATIVE_JSON_SCHEMA,

  // Mistral - partial support
  mistral: StructuredOutputSupport.CONSTRAINED_DECODING,

  // OpenAI-compatible - check dynamically
  openai_compatible: StructuredOutputSupport.INSTRUCTION_ONLY,

  // Unknown providers - assume instruction only
};

/**
 * Detect structured output support for a provider
 */
function detectProviderSupport(providerId: string, modelId: string): StructuredOutputSupport {
  // Direct lookup
  if (providerId in PROVIDER_CAPABILITIES) {
    return PROVIDER_CAPABILITIES[providerId];
  }

  // Check for known model families
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-")) {
    return StructuredOutputSupport.NATIVE_JSON_SCHEMA;
  }

  if (modelId.startsWith("claude-") || modelId.startsWith("claude-")) {
    return StructuredOutputSupport.TOOL_BASED;
  }

  if (modelId.startsWith("gemini-")) {
    return StructuredOutputSupport.NATIVE_JSON_SCHEMA;
  }

  if (modelId.startsWith("mistral-") || modelId.startsWith("mixtral-")) {
    return StructuredOutputSupport.CONSTRAINED_DECODING;
  }

  // Default to instruction-based
  return StructuredOutputSupport.INSTRUCTION_ONLY;
}
```

### 14.3 Schema Transformation Utilities

```typescript
/**
 * Transform JSON schema for OpenAI structured output compatibility
 *
 * Reference: @tanstack-ai/openai/src/utils/schema-converter.ts
 *
 * OpenAI requirements:
 * - All properties must be in the `required` array
 * - Optional fields should have null added to their type union
 * - additionalProperties must be false for objects
 * - oneOf is not supported
 */
export function transformSchemaForOpenAI(
  schema: JSONSchema,
  originalRequired: string[] = []
): JSONSchema {
  const result = { ...schema };

  // Handle object types
  if (result.type === "object" && result.properties) {
    const properties = { ...result.properties };
    const allPropertyNames = Object.keys(properties);

    // Transform each property
    for (const propName of allPropertyNames) {
      const prop = properties[propName];
      const wasOptional = !originalRequired.includes(propName);

      // Recursively transform nested objects/arrays
      if (prop.type === "object" && prop.properties) {
        properties[propName] = transformSchemaForOpenAI(prop, prop.required || []);
      } else if (prop.type === "array" && prop.items) {
        properties[propName] = {
          ...prop,
          items: transformSchemaForOpenAI(prop.items, prop.items.required || []),
        };
      } else if (prop.anyOf) {
        properties[propName] = transformSchemaForOpenAI(prop, prop.required || []);
      } else if (prop.oneOf) {
        throw new Error(
          "oneOf is not supported in OpenAI structured output schemas. " +
            "See: https://platform.openai.com/docs/guides/structured-outputs"
        );
      } else if (wasOptional) {
        // Make optional fields nullable
        if (prop.type && !Array.isArray(prop.type)) {
          properties[propName] = {
            ...prop,
            type: [prop.type, "null"],
          };
        } else if (Array.isArray(prop.type) && !prop.type.includes("null")) {
          properties[propName] = {
            ...prop,
            type: [...prop.type, "null"],
          };
        }
      }
    }

    result.properties = properties;
    result.required = allPropertyNames;
    result.additionalProperties = false;
  }

  // Handle array types
  if (result.type === "array" && result.items) {
    result.items = transformSchemaForOpenAI(result.items, result.items.required || []);
  }

  // Handle anyOf
  if (result.anyOf && Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map(variant =>
      transformSchemaForOpenAI(variant, variant.required || [])
    );
  }

  // Reject oneOf
  if (result.oneOf) {
    throw new Error(
      "oneOf is not supported in OpenAI structured output schemas. " +
        "See: https://platform.openai.com/docs/guides/structured-outputs"
    );
  }

  return result;
}

/**
 * Transform null values to undefined (post-processing)
 *
 * OpenAI returns null for optional fields that were made nullable.
 * This transforms them back to undefined to match original schema expectations.
 */
export function transformNullsToUndefined<T>(obj: T): T {
  if (obj === null) {
    return undefined as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => transformNullsToUndefined(item)) as unknown as T;
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const transformed = transformNullsToUndefined(value);
      // Omit undefined values (null becomes absent field)
      if (transformed !== undefined) {
        result[key] = transformed;
      }
    }
    return result as T;
  }

  return obj;
}
```

### 14.4 Robust JSON Parsing with Fallbacks

````typescript
/**
 * Parse JSON with multiple fallback strategies
 *
 * Handles:
 * - Direct JSON parsing
 * - Code block extraction (```json ... ```)
 * - Trailing text after JSON
 * - Partial JSON recovery
 */
export function parseJSONWithFallbacks(
  text: string,
  context?: { schema?: JSONSchema; modelName?: string }
): { success: true; data: unknown; rawText: string } | { success: false; error: string } {
  const trimmed = text.trim();
  const ctx = context ? ` [${context.modelName || "model"}]` : "";

  // Strategy 1: Direct JSON parse
  try {
    const data = JSON.parse(trimmed);
    return { success: true, data, rawText: trimmed };
  } catch {
    // Continue to fallback strategies
  }

  // Strategy 2: Extract from code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    try {
      const data = JSON.parse(codeBlockMatch[1]);
      return { success: true, data, rawText: codeBlockMatch[1] };
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 3: Extract JSON from mixed content
  // Find first { and last } and extract everything between
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const extracted = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      const data = JSON.parse(extracted);
      return { success: true, data, rawText: extracted };
    } catch {
      // Final strategy failed
    }
  }

  // All strategies failed
  return {
    success: false,
    error:
      `Failed to parse structured output${ctx}. ` +
      `Tried: direct parse, code block extraction, brace extraction. ` +
      `Content preview: ${trimmed.substring(0, 200)}${trimmed.length > 200 ? "..." : ""}`,
  };
}
````

### 14.5 Complete Structured Output Implementation

```typescript
/**
 * Mastra adapter structured output implementation
 *
 * Handles all provider types with appropriate strategies:
 * - NATIVE_JSON_SCHEMA: Use provider's native JSON schema API
 * - TOOL_BASED: Force tool call with schema
 * - CONSTRAINED_DECODING: Use constrained decoding if available
 * - INSTRUCTION_ONLY: System prompt + robust parsing
 */
async structuredOutput(
  options: StructuredOutputOptions<MastraTextProviderOptions>
): Promise<StructuredOutputResult<unknown>> {
  const { chatOptions, outputSchema } = options;

  // Detect provider support
  const { provider, modelId } = parseModelString(this.model);
  const support = detectProviderSupport(provider, modelId);

  switch (support) {
    case StructuredOutputSupport.NATIVE_JSON_SCHEMA:
      return await this.structuredOutputNative(chatOptions, outputSchema);

    case StructuredOutputSupport.TOOL_BASED:
      return await this.structuredOutputToolBased(chatOptions, outputSchema);

    case StructuredOutputSupport.CONSTRAINED_DECODING:
      return await this.structuredOutputConstrained(chatOptions, outputSchema);

    case StructuredOutputSupport.INSTRUCTION_ONLY:
    default:
      return await this.structuredOutputInstruction(chatOptions, outputSchema);
  }
}

/**
 * Native JSON schema support (OpenAI, Gemini, etc.)
 */
private async structuredOutputNative(
  chatOptions: TextOptions<MastraTextProviderOptions>,
  outputSchema: JSONSchema
): Promise<StructuredOutputResult<unknown>> {
  const aiSdkMessages = convertToAISDKMessages(chatOptions.messages);

  // For OpenAI models, transform schema
  const { provider } = parseModelString(this.model);
  const schema = provider === 'openai' || provider === 'openai_compatible'
    ? transformSchemaForOpenAI(outputSchema, outputSchema.required || [])
    : outputSchema;

  // Use Mastra's doGenerate (non-streaming)
  const result = await this.mastraModel.doGenerate({
    messages: aiSdkMessages,
    temperature: chatOptions.temperature ?? 0,
    // Provider-specific options for structured output
    providerOptions: {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'structured_output',
          schema: schema,
        },
        strict: true,
      },
    },
  });

  // Extract text from stream
  let text = '';
  for await (const chunk of result.stream) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
    }
  }

  // Parse response
  const parsed = parseJSONWithFallbacks(text, { modelName: this.model });

  if (!parsed.success) {
    throw new Error(parsed.error);
  }

  // Transform nulls to undefined for OpenAI
  const data = provider === 'openai' || provider === 'openai_compatible'
    ? transformNullsToUndefined(parsed.data)
    : parsed.data;

  return {
    data,
    rawText: parsed.rawText,
  };
}

/**
 * Tool-based structured output (Anthropic-style)
 *
 * Reference: @tanstack-ai-anthropic/src/adapters/text.ts:156-232
 */
private async structuredOutputToolBased(
  chatOptions: TextOptions<MastraTextProviderOptions>,
  outputSchema: JSONSchema
): Promise<StructuredOutputResult<unknown>> {
  const aiSdkMessages = convertToAISDKMessages(chatOptions.messages);

  // Create a tool that captures the structured output
  const structuredOutputTool = {
    type: 'function' as const,
    name: 'structured_output',
    description: 'Use this tool to provide your response in the required structured format.',
    parameters: {
      type: 'object',
      properties: outputSchema.properties ?? {},
      required: outputSchema.required ?? [],
      additionalProperties: false,
    },
  };

  // Force tool choice
  const result = await this.mastraModel.doGenerate({
    messages: aiSdkMessages,
    tools: [structuredOutputTool],
    toolChoice: { type: 'required', toolName: 'structured_output' },
    temperature: 0,
  });

  // Extract tool use from response
  let data: unknown = null;
  let rawText = '';

  for await (const chunk of result.stream) {
    if (chunk.type === 'tool-call' && chunk.toolName === 'structured_output') {
      try {
        data = JSON.parse(chunk.arguments);
        rawText = chunk.arguments;
        break;
      } catch {
        // Continue to extraction
      }
    } else if (chunk.type === 'text-delta') {
      rawText += chunk.text;
    }
  }

  // Fallback: extract from text content
  if (data === null) {
    const parsed = parseJSONWithFallbacks(rawText, { modelName: this.model });
    if (!parsed.success) {
      throw new Error(parsed.error);
    }
    data = parsed.data;
    rawText = parsed.rawText;
  }

  return { data, rawText };
}

/**
 * Constrained decoding (Mistral-style)
 */
private async structuredOutputConstrained(
  chatOptions: TextOptions<MastraTextProviderOptions>,
  outputSchema: JSONSchema
): Promise<StructuredOutputResult<unknown>> {
  // Try native first, fall back to tool-based
  try {
    return await this.structuredOutputNative(chatOptions, outputSchema);
  } catch {
    return await this.structuredOutputToolBased(chatOptions, outputSchema);
  }
}

/**
 * Instruction-based structured output (fallback for all providers)
 *
 * Uses system prompt + robust JSON parsing
 */
private async structuredOutputInstruction(
  chatOptions: TextOptions<MastraTextProviderOptions>,
  outputSchema: JSONSchema
): Promise<StructuredOutputResult<unknown>> {
  const aiSdkMessages = convertToAISDKMessages(chatOptions.messages);

  // Build comprehensive system prompt
  const systemPrompt = this.buildStructuredOutputPrompt(outputSchema);

  // Add system message
  const messagesWithPrompt = [
    { role: 'system', content: systemPrompt },
    ...aiSdkMessages,
  ];

  // Use low temperature for deterministic output
  const result = await this.mastraModel.doGenerate({
    messages: messagesWithPrompt,
    temperature: 0,
    maxTokens: chatOptions.maxTokens,
  });

  // Extract text
  let text = '';
  for await (const chunk of result.stream) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
    }
  }

  // Parse with fallbacks
  const parsed = parseJSONWithFallbacks(text, {
    schema: outputSchema,
    modelName: this.model,
  });

  if (!parsed.success) {
    throw new Error(parsed.error);
  }

  return {
    data: parsed.data,
    rawText: parsed.rawText,
  };
}

/**
 * Build a comprehensive system prompt for structured output
 */
private buildStructuredOutputPrompt(schema: JSONSchema): string {
  const schemaString = JSON.stringify(schema, null, 2);

  return `You must respond with valid JSON that conforms to the following schema:

\`\`\`json
${schemaString}
\`\`\`

CRITICAL REQUIREMENTS:
1. Respond ONLY with valid JSON - no additional text
2. Do NOT include markdown code blocks (like \`\`\`json)
3. Do NOT include explanations or commentary
4. All required fields must be present
5. Use null for optional fields that don't apply
6. Ensure proper JSON syntax (commas, quotes, braces)

Your response will be parsed as JSON directly.`;
}
```

### 14.6 Error Recovery and Validation

```typescript
/**
 * Enhanced structured output with retry logic
 */
async structuredOutputWithRetry(
  options: StructuredOutputOptions<MastraTextProviderOptions>,
  maxRetries: number = 2
): Promise<StructuredOutputResult<unknown>> {
  const { chatOptions, outputSchema } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // On retry, add more explicit instructions
      const enhancedOptions = attempt > 0
        ? {
            ...options,
            chatOptions: {
              ...chatOptions,
              systemPrompts: [
                ...(chatOptions.systemPrompts || []),
                `IMPORTANT: This is attempt ${attempt + 1}. ` +
                'You MUST respond with valid JSON only. No markdown, no explanations.',
              ],
            },
          }
        : options;

      return await this.structuredOutput(enhancedOptions);

    } catch (error) {
      const err = error as Error;

      // Don't retry on validation errors
      if (err.message.includes('validation') || err.message.includes('schema')) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt === maxRetries) {
        throw new Error(
          `Structured output failed after ${maxRetries + 1} attempts. ` +
          `Last error: ${err.message}`
        );
      }

      // Log retry and continue
      console.warn(`[MastraAdapter] Structured output attempt ${attempt + 1} failed: ${err.message}`);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error('Structured output failed');
}

/**
 * Validate parsed data against schema (basic validation)
 * For full validation, TanStack AI will use Standard Schema
 */
private validateAgainstSchema(
  data: unknown,
  schema: JSONSchema
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  // Basic type checking
  if (schema.type === 'object' && typeof data === 'object' && data !== null) {
    // Check required properties
    const required = schema.required || [];
    for (const prop of required) {
      if (!(prop in (data as Record<string, unknown>))) {
        errors.push(`Missing required property: ${prop}`);
      }
    }

    // Check additional properties
    if (schema.additionalProperties === false) {
      const extraProps = Object.keys(data as Record<string, unknown>)
        .filter(key => !(schema.properties || {}).hasOwnProperty(key));
      if (extraProps.length > 0) {
        errors.push(`Unexpected properties: ${extraProps.join(', ')}`);
      }
    }
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}
```

### 14.7 Testing Strategy

```typescript
describe("StructuredOutput", () => {
  describe("parseJSONWithFallbacks", () => {
    it("should parse direct JSON", () => {
      const result = parseJSONWithFallbacks('{"key": "value"}');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ key: "value" });
      }
    });

    it("should extract from code block", () => {
      const result = parseJSONWithFallbacks(`
Here's the result:

\`\`\`json
{"key": "value"}
\`\`\`

Done.
      `);
      expect(result.success).toBe(true);
    });

    it("should extract from mixed content", () => {
      const result = parseJSONWithFallbacks(`
        The response is {"key": "value"} and that's it.
      `);
      expect(result.success).toBe(true);
    });
  });

  describe("transformSchemaForOpenAI", () => {
    it("should make optional fields nullable", () => {
      const schema = {
        type: "object",
        properties: {
          required: { type: "string" },
          optional: { type: "string" },
        },
        required: ["required"],
      };

      const transformed = transformSchemaForOpenAI(schema, ["required"]);

      expect(transformed.properties.optional.type).toEqual(["string", "null"]);
      expect(transformed.required).toEqual(["required", "optional"]);
    });

    it("should reject oneOf", () => {
      const schema = {
        type: "object",
        properties: {
          field: { oneOf: [{ type: "string" }, { type: "number" }] },
        },
      };

      expect(() => transformSchemaForOpenAI(schema)).toThrow("oneOf");
    });
  });

  describe("transformNullsToUndefined", () => {
    it("should convert null to undefined", () => {
      const result = transformNullsToUndefined({ a: null, b: "value" });
      expect(result).toEqual({ b: "value" }); // 'a' omitted
    });

    it("should handle nested objects", () => {
      const result = transformNullsToUndefined({
        a: { nested: null, value: "test" },
      });
      expect(result).toEqual({ a: { value: "test" } });
    });
  });
});
```

### 14.8 Decision Matrix

| Provider          | Support Level        | Strategy                      | Schema Transform   |
| ----------------- | -------------------- | ----------------------------- | ------------------ |
| OpenAI            | NATIVE_JSON_SCHEMA   | `response_format.json_schema` | OpenAI transforms  |
| Anthropic         | TOOL_BASED           | Force tool call               | None (standard)    |
| Google Gemini     | NATIVE_JSON_SCHEMA   | `responseSchema`              | None (standard)    |
| Mistral           | CONSTRAINED_DECODING | Native → Tool fallback        | Native transforms  |
| OpenAI-compatible | INSTRUCTION_ONLY     | System prompt + parse         | Instruction schema |
| Unknown           | INSTRUCTION_ONLY     | System prompt + parse         | Instruction schema |

---

## 15. AI SDK V2/V3 Compatibility (Simplified)

**TL;DR:** You don't need to worry about V2/V3 compatibility. Mastra handles it internally, and all providers currently use V5 SDKs (V2 interface) with normalized stream output.

### 15.1 Current State Analysis

Based on analysis of Mastra's gateway implementations:

```typescript
// All gateways use V5 SDKs:
import { createAnthropic } from "@ai-sdk/anthropic-v5";
import { createGoogleGenerativeAI } from "@ai-sdk/google-v5";
import { createMistral } from "@ai-sdk/mistral-v5";
import { createOpenAI } from "@ai-sdk/openai-v5";
```

**Key Finding:** While Mastra's `package.json` includes both V5 and V6 provider packages, **all gateway implementations use V5 SDKs exclusively**.

### 15.2 Why V2/V3 Doesn't Matter for the Adapter

| Concern                       | Reality                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| **"V2-only models exist"**    | ❌ False - all providers support V5/V6                      |
| **"Need to detect version"**  | ❌ False - Mastra abstracts this away                       |
| **"Stream formats differ"**   | ❌ False - normalized by `createStreamFromGenerateResult()` |
| **"Need version-aware code"** | ❌ False - not necessary                                    |

### 15.3 Simplified Adapter (Recommended)

```typescript
/**
 * Simplified Mastra adapter - no version complexity needed
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
    this.mastraModel = new ModelRouterLanguageModel({ id: modelId, ...config });
  }

  async *chatStream(options: TextOptions<MastraTextProviderOptions>): AsyncIterable<StreamChunk> {
    // Convert messages and tools
    const aiSdkMessages = convertToAISDKMessages(options.messages);
    const aiSdkTools = options.tools ? convertToolsToAISDK(options.tools) : undefined;

    // Call Mastra - handles V2/V3 internally if needed
    const streamResult = await this.mastraModel.doStream({
      messages: aiSdkMessages,
      tools: aiSdkTools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      topP: options.topP,
      abortSignal: options.request?.signal,
    });

    // Transform normalized stream to TanStack format
    yield* transformMastraStreamToTanStack(streamResult.stream, this.model);
  }

  async structuredOutput(
    options: StructuredOutputOptions<MastraTextProviderOptions>
  ): Promise<StructuredOutputResult<unknown>> {
    // Use structured output implementation from Section 14
    // No version detection needed
    return await this.executeStructuredOutput(
      detectProviderSupport(this.parseModelString(this.model).provider, this.model),
      options.chatOptions,
      options.outputSchema
    );
  }

  private parseModelString(model: ModelRouterModelId): { provider: string; modelId: string } {
    // Parse "provider/model" format
    const slashIndex = model.indexOf("/");
    return slashIndex >= 0
      ? { provider: model.substring(0, slashIndex), modelId: model.substring(slashIndex + 1) }
      : { provider: "unknown", modelId: model };
  }
}
```

### 15.4 When Would V3 Matter?

Only in these edge cases:

1. **Custom gateways** - If you create a gateway using provider SDKs that only have V6 versions
2. **Direct model passing** - If someone passes a raw `LanguageModelV3` to `ModelRouterLanguageModel`
3. **Future migrations** - If Mastra upgrades gateways to use V6 SDKs

**For initial implementation: Ignore all of this.**

### 15.5 Testing Strategy

**No V2/V3 specific tests needed.** Focus on:

- Stream transformation correctness
- Tool call buffering
- Structured output parsing
- Error handling

### 15.6 Migration Notes

**If you later encounter V3-specific issues:**

1. Add minimal version detection where needed
2. Use Mastra's `isLanguageModelV3()` helper from `router.ts:20-22`
3. Log version info for debugging

**Until then: Keep it simple.**
