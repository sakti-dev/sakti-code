/**
 * MastraTextAdapter - Main adapter implementation
 *
 * Provides a TanStack AI adapter interface for Mastra's model router system.
 * This is a reference implementation that demonstrates the integration pattern.
 */

import type { LanguageModelV1CallOptions, LanguageModelV1StreamPart } from "@ai-sdk/provider";
import type { JSONSchema, StreamChunk, TextOptions } from "@tanstack/ai";
import { BaseTextAdapter, StructuredOutputResult } from "@tanstack/ai/adapters";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { convertToAISDKMessages } from "../convert";
import { isCompleteJSON } from "../stream";
import {
  detectProviderSupport,
  parseJSONWithFallbacks,
  transformSchemaForOpenAI,
} from "../structured-output";
import type { MastraMessageMetadataByModality } from "../types";
import { StructuredOutputSupport } from "../types";

// Re-export StructuredOutputSupport for convenience
export { StructuredOutputSupport };

/**
 * Type for resolved provider options (empty for Mastra adapter)
 */
export type MastraProviderOptions = Record<string, never>;

/**
 * Interface for Mastra-compatible language model
 * This matches the interface of ModelRouterLanguageModel from @mastra/core
 */
export interface MastraLanguageModel {
  readonly specificationVersion: "v1" | "v2";
  readonly modelId: string;

  doStream(options: LanguageModelV1CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
  }>;

  doGenerate?(options: LanguageModelV1CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
  }>;
}

/**
 * MastraTextAdapter - TanStack AI adapter for Mastra's ModelRouterLanguageModel
 *
 * @example
 * ```typescript
 * import { MastraTextAdapter } from '@ekacode/mastra-tanstack'
 * import { ModelRouterLanguageModel } from '@mastra/core'
 *
 * const mastraModel = new ModelRouterLanguageModel('openai/gpt-4o')
 * const adapter = new MastraTextAdapter('openai/gpt-4o', {}, mastraModel)
 * ```
 */
export class MastraTextAdapter extends BaseTextAdapter<
  string,
  MastraProviderOptions,
  ["text", "image"],
  MastraMessageMetadataByModality
> {
  readonly name = "mastra" as const;
  protected config: MastraProviderOptions;

  // Mastra language model instance
  private mastraModel: MastraLanguageModel | null;

  constructor(
    modelId: string,
    _config: MastraProviderOptions = {},
    mastraModel?: MastraLanguageModel
  ) {
    super({}, modelId);

    // Use provided model or create a placeholder
    this.mastraModel = mastraModel || null;
    this.config = {}; // Initialize config to match base class expectation
  }

  /**
   * Set or update the Mastra language model
   *
   * @param mastraModel - Mastra language model instance
   */
  setModel(mastraModel: MastraLanguageModel): void {
    this.mastraModel = mastraModel;
  }

  /**
   * Stream text completions from Mastra's model router
   *
   * @param options - Text generation options
   * @returns Async iterable of stream chunks
   */
  async *chatStream(
    options: TextOptions<MastraProviderOptions, MastraProviderOptions>
  ): AsyncIterable<StreamChunk> {
    if (!this.mastraModel) {
      yield {
        type: "error",
        id: this.generateId(),
        model: this.model,
        timestamp: Date.now(),
        error: {
          message:
            "Mastra language model not set. Provide a model via constructor or setModel() method.",
          code: "MODEL_NOT_SET",
        },
      };
      return;
    }

    const messages = options.messages || [];
    const tools = options.tools?.map(tool => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callOptions: any = {
      prompt: convertToAISDKMessages(messages),
      tools: tools?.length ? tools : undefined,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
    };

    const response = await this.mastraModel.doStream(callOptions);
    const stream = response.stream;

    // Transform AI SDK stream to TanStack format
    yield* this.transformStreamToTanStack(stream);
  }

  /**
   * Generate structured output from Mastra's model router
   *
   * @param options - Structured output options
   * @returns Structured output result with parsed data and raw text
   */

  async structuredOutput<T = unknown>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any
  ): Promise<StructuredOutputResult<T>> {
    if (!this.mastraModel) {
      throw new Error(
        "Mastra language model not set. Provide a model via constructor or setModel() method."
      );
    }

    const { chatOptions, outputSchema } = options;
    const messages = chatOptions.messages || [];

    // Detect provider capabilities
    const capabilities = detectProviderSupport(this.model.split("/")[0], this.model);

    // Choose strategy based on provider support
    if (capabilities.structuredOutput === StructuredOutputSupport.NATIVE_JSON_SCHEMA) {
      return this.generateNativeStructuredOutput(messages, outputSchema as JSONSchema);
    }

    if (capabilities.structuredOutput === StructuredOutputSupport.TOOL_BASED) {
      return this.generateToolBasedStructuredOutput(messages, outputSchema as JSONSchema);
    }

    // Fallback to instruction-only mode
    return this.generateInstructionOnlyStructuredOutput(messages, outputSchema as JSONSchema);
  }

  /**
   * Generate structured output using native JSON schema mode
   */

  private async generateNativeStructuredOutput<T = unknown>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
    schema: JSONSchema
  ): Promise<StructuredOutputResult<T>> {
    const transformedSchema = transformSchemaForOpenAI(schema);
    const responseFormat = {
      type: "json_schema" as const,
      jsonSchema: transformedSchema,
    };

    // Add instruction message
    const instructionMessage = {
      role: "system" as const,
      content: `You must respond with valid JSON that matches this schema:\n${JSON.stringify(schema, null, 2)}\n\nRespond ONLY with the JSON object, without any additional text or explanation.`,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callOptions: any = {
      prompt: convertToAISDKMessages([instructionMessage, ...messages]),
      responseFormat: responseFormat, // OpenAI-specific format
    };

    const result = await this.mastraModel!.doGenerate!(callOptions);
    const stream = result.stream;

    let rawText = "";
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value.type === "text-delta") {
          rawText += value.textDelta;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const data = parseJSONWithFallbacks(rawText) as T;

    return {
      data,
      rawText,
    };
  }

  /**
   * Generate structured output using tool-based approach
   */

  private async generateToolBasedStructuredOutput<T = unknown>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
    schema: JSONSchema
  ): Promise<StructuredOutputResult<T>> {
    // Create a tool that returns structured data
    const tool = {
      type: "function" as const,
      name: "provideStructuredOutput",
      description: "Provide structured data according to the schema",
      parameters: schema,
    };

    const instructionMessage = {
      role: "system" as const,
      content: `Use the provideStructuredOutput tool to return data matching the required schema.`,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callOptions: any = {
      prompt: convertToAISDKMessages([instructionMessage, ...messages]),
      tools: [tool],
    };

    const result = await this.mastraModel!.doGenerate!(callOptions);
    const stream = result.stream;

    let toolCallArgs = "";

    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value.type === "tool-call-delta") {
          if (value.argsTextDelta) {
            toolCallArgs += value.argsTextDelta;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const data = parseJSONWithFallbacks(toolCallArgs) as T;

    return {
      data,
      rawText: toolCallArgs,
    };
  }

  /**
   * Generate structured output using instruction-only mode
   */

  private async generateInstructionOnlyStructuredOutput<T = unknown>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[],
    schema: JSONSchema
  ): Promise<StructuredOutputResult<T>> {
    const instructions = `Your response must be valid JSON only, without any additional text or explanation.\n\nSchema:\n${JSON.stringify(schema, null, 2)}`;

    const instructionMessage = {
      role: "system" as const,
      content: instructions,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callOptions: any = {
      prompt: convertToAISDKMessages([instructionMessage, ...messages]),
    };

    const result = await this.mastraModel!.doGenerate!(callOptions);
    const stream = result.stream;

    let rawText = "";
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value.type === "text-delta") {
          rawText += value.textDelta;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const data = parseJSONWithFallbacks(rawText) as T;

    return {
      data,
      rawText,
    };
  }

  /**
   * Transform AI SDK stream to TanStack format
   */
  protected async *transformStreamToTanStack(
    stream: ReadableStream<LanguageModelV1StreamPart>
  ): AsyncIterable<StreamChunk> {
    const timestamp = Date.now();
    let responseId: string | null = null;

    let accumulatedContent = "";
    let accumulatedThinking = "";

    // Tool call accumulation
    const toolCalls = new Map<string, { toolName: string; args: string; index: number }>();
    let nextToolIndex = 0;

    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = value;
        responseId = responseId || this.generateId();

        switch (chunk.type) {
          case "text-delta": {
            accumulatedContent += chunk.textDelta;
            yield {
              type: "content",
              id: responseId,
              model: this.model,
              timestamp,
              delta: chunk.textDelta,
              content: accumulatedContent,
              role: "assistant",
            };
            break;
          }

          case "tool-call-delta": {
            const { toolCallId, toolName, argsTextDelta } = chunk;

            if (!toolCalls.has(toolCallId)) {
              toolCalls.set(toolCallId, {
                toolName: toolName || "",
                args: "",
                index: nextToolIndex++,
              });
            }

            const call = toolCalls.get(toolCallId)!;
            if (argsTextDelta) {
              call.args += argsTextDelta;
            }

            // Check if we have a complete tool call
            if (isCompleteJSON(call.args)) {
              toolCalls.delete(toolCallId);
              yield {
                type: "tool_call",
                id: responseId,
                model: this.model,
                timestamp,
                toolCall: {
                  id: toolCallId,
                  type: "function",
                  function: {
                    name: call.toolName,
                    arguments: call.args,
                  },
                },
                index: call.index,
              };
            }
            break;
          }

          case "reasoning": {
            accumulatedThinking += chunk.textDelta;
            yield {
              type: "thinking",
              id: responseId,
              model: this.model,
              timestamp,
              delta: chunk.textDelta,
              content: accumulatedThinking,
            };
            break;
          }

          case "finish": {
            yield {
              type: "done",
              id: responseId,
              model: this.model,
              timestamp,
              finishReason: this.mapFinishReason(chunk.finishReason),
              usage: chunk.usage ? this.mapUsage(chunk.usage) : undefined,
            };
            break;
          }

          case "error": {
            const errorMsg = chunk.error;
            yield {
              type: "error",
              id: responseId,
              model: this.model,
              timestamp,
              error: {
                message: typeof errorMsg === "string" ? errorMsg : String(errorMsg),
                code: (errorMsg as { code?: string })?.code,
              },
            };
            break;
          }

          default:
            // Ignore unknown chunk types
            break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Generate a unique ID for stream chunks
   */
  protected generateId(): string {
    return `mastra-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Map AI SDK usage to TanStack format
   */
  private mapUsage(usage: { promptTokens?: number; completionTokens?: number }): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } {
    const promptTokens = usage.promptTokens ?? 0;
    const completionTokens = usage.completionTokens ?? 0;

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  /**
   * Map AI SDK finish reason to TanStack format
   */
  private mapFinishReason(
    finishReason: string | undefined | null
  ): "stop" | "length" | "content_filter" | "tool_calls" | null {
    switch (finishReason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content-filter":
        return "content_filter";
      case "tool-calls":
        return "tool_calls";
      default:
        return "stop";
    }
  }
}
