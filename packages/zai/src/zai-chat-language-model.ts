import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId as generateId_Util,
  isParsableJson,
  parseProviderOptions,
  postJsonToApi,
  type FetchFunction,
  type ParseResult,
} from "@ai-sdk/provider-utils";
import { convertToZaiChatMessages } from "./chat/convert-to-zai-chat-messages";
import { mapZaiChatResponse } from "./chat/map-zai-chat-response";
import type { ZaiChatChunk, ZaiChatRequest, ZaiChatResponse, ZaiTool } from "./chat/zai-chat-api";
import { zaiChatChunkSchema, zaiChatResponseSchema } from "./chat/zai-chat-api";
import type { ZaiChatLanguageModelOptions, ZaiChatModelId } from "./chat/zai-chat-settings";
import { zaiChatLanguageModelOptions } from "./chat/zai-chat-settings";
import { zaiFailedResponseHandler } from "./zai-error";

export interface ZaiChatConfig {
  provider: string;
  url: ({ path }: { path: string }) => string;
  headers: () => Promise<Record<string, string | undefined>>;
  fetch?: FetchFunction;
}

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

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { args, warnings } = await this.getArgs(options);

    const response = await postJsonToApi<ZaiChatResponse>({
      url: this.config.url({
        path: "/chat/completions",
      }),
      headers: combineHeaders(await this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: zaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(zaiChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const result = mapZaiChatResponse({
      response: response.value,
      warnings,
    });

    return {
      ...result,
      request: { body: args },
      response: {
        id: response.value.id,
        modelId: response.value.model,
        timestamp: new Date(response.value.created * 1000),
        headers: response.responseHeaders,
        body: response.rawValue,
      },
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const { args, warnings } = await this.getArgs(options);

    const body = {
      ...args,
      stream: true,
    };

    const response = await postJsonToApi({
      url: this.config.url({
        path: "/chat/completions",
      }),
      headers: combineHeaders(await this.config.headers(), options.headers),
      body,
      failedResponseHandler: zaiFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(zaiChatChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const toolCalls: Map<
      number,
      { id: string; name: string; arguments: string; hasFinished: boolean }
    > = new Map();

    let finishReason: LanguageModelV3GenerateResult["finishReason"] = {
      unified: "other",
      raw: undefined,
    };
    let usage: ZaiChatResponse["usage"] | undefined = undefined;
    let metadataExtracted = false;
    let isActiveText = false;
    let isActiveReasoning = false;

    const generateId = generateId_Util;

    const stream = response.value.pipeThrough(
      new TransformStream<ParseResult<ZaiChatChunk>, LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings });
        },

        transform(chunk, controller) {
          if (options.includeRawChunks) {
            controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
          }

          if (!chunk.success) {
            finishReason = { unified: "error", raw: undefined };
            controller.enqueue({
              type: "error",
              error: chunk.error,
            });
            return;
          }

          const value = chunk.value!;

          if (!metadataExtracted && (value.created || value.model)) {
            metadataExtracted = true;
            controller.enqueue({
              type: "response-metadata",
              id: value.id,
              modelId: value.model,
              timestamp: value.created ? new Date(value.created * 1000) : undefined,
            });
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
              controller.enqueue({
                type: "reasoning-start",
                id: "0",
              });
              isActiveReasoning = true;
            }
            controller.enqueue({
              type: "reasoning-delta",
              id: "0",
              delta: delta.reasoning_content,
            });
          }

          // Handle text content
          if (delta.content != null) {
            if (!isActiveText) {
              controller.enqueue({ type: "text-start", id: "0" });
              isActiveText = true;
            }
            controller.enqueue({
              type: "text-delta",
              id: "0",
              delta: delta.content,
            });
          }

          // Handle tool calls
          if (delta.tool_calls != null) {
            if (isActiveReasoning) {
              controller.enqueue({ type: "reasoning-end", id: "0" });
              isActiveReasoning = false;
            }

            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index ?? toolCalls.size;

              if (toolCalls.get(index) == null) {
                // New tool call
                const id = toolCallDelta.id ?? generateId();
                const name = toolCallDelta.function?.name ?? "";
                const args = toolCallDelta.function?.arguments ?? "";

                controller.enqueue({
                  type: "tool-input-start",
                  id,
                  toolName: name,
                });

                toolCalls.set(index, {
                  id,
                  name,
                  arguments: args,
                  hasFinished: false,
                });

                if (args) {
                  controller.enqueue({
                    type: "tool-input-delta",
                    id,
                    delta: args,
                  });
                }

                // Check if complete (parsable JSON)
                if (isParsableJson(args)) {
                  controller.enqueue({
                    type: "tool-input-end",
                    id,
                  });

                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: id,
                    toolName: name,
                    input: args,
                  });

                  const toolCall = toolCalls.get(index);
                  if (toolCall) {
                    toolCall.hasFinished = true;
                  }
                }
              } else {
                // Existing tool call - append arguments
                const existingCall = toolCalls.get(index)!;
                if (existingCall.hasFinished) {
                  continue;
                }
                if (toolCallDelta.function?.arguments != null) {
                  existingCall.arguments += toolCallDelta.function.arguments;

                  controller.enqueue({
                    type: "tool-input-delta",
                    id: existingCall.id,
                    delta: toolCallDelta.function.arguments,
                  });

                  // Check if complete
                  if (isParsableJson(existingCall.arguments)) {
                    controller.enqueue({
                      type: "tool-input-end",
                      id: existingCall.id,
                    });

                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: existingCall.id,
                      toolName: existingCall.name,
                      input: existingCall.arguments,
                    });
                    existingCall.hasFinished = true;
                  }
                }
              }
            }
          }
        },

        flush(controller) {
          if (isActiveReasoning) {
            controller.enqueue({ type: "reasoning-end", id: "0" });
          }
          if (isActiveText) {
            controller.enqueue({ type: "text-end", id: "0" });
          }

          for (const toolCall of toolCalls.values()) {
            if (toolCall.hasFinished) {
              continue;
            }

            controller.enqueue({
              type: "tool-input-end",
              id: toolCall.id,
            });

            controller.enqueue({
              type: "tool-call",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: toolCall.arguments,
            });
          }

          controller.enqueue({
            type: "finish",
            finishReason,
            usage: convertZaiChatUsage(usage),
          });
        },
      })
    );

    return {
      stream: stream as unknown as LanguageModelV3StreamResult["stream"],
      request: { body },
      response: { headers: response.responseHeaders },
    };
  }

  private async getArgs(
    options: LanguageModelV3CallOptions
  ): Promise<{ args: ZaiChatRequest; warnings: SharedV3Warning[] }> {
    const { messages, warnings } = convertToZaiChatMessages({
      prompt: options.prompt,
    });

    const providerOptions =
      (await parseProviderOptions<ZaiChatLanguageModelOptions>({
        provider: "zai",
        providerOptions: options.providerOptions,
        schema: zaiChatLanguageModelOptions,
      })) ?? ({} satisfies ZaiChatLanguageModelOptions);

    // Temperature clamping to (0, 1) and do_sample handling
    let temperature = options.temperature;
    let doSample: boolean | undefined = providerOptions.do_sample;

    if (temperature !== undefined) {
      if (temperature <= 0) {
        temperature = 0.01;
        doSample = false;
      } else if (temperature >= 1) {
        temperature = 0.99;
      }
    }

    // top_p clamping to (0, 1)
    let topP = options.topP;
    if (topP !== undefined) {
      if (topP <= 0) {
        topP = 0.01;
      } else if (topP >= 1) {
        topP = 0.99;
      }
    }

    // Emit warnings for unsupported parameters
    if (options.topK !== undefined) {
      warnings.push({
        type: "unsupported",
        feature: "topK",
      });
    }

    if (options.presencePenalty !== undefined) {
      warnings.push({
        type: "unsupported",
        feature: "presencePenalty",
      });
    }

    if (options.frequencyPenalty !== undefined) {
      warnings.push({
        type: "unsupported",
        feature: "frequencyPenalty",
      });
    }

    // Response format mapping
    let response_format: ZaiChatRequest["response_format"] = undefined;
    if (options.responseFormat !== undefined) {
      if (options.responseFormat.type === "json") {
        response_format = { type: "json_object" };

        if (
          options.responseFormat.schema !== undefined ||
          options.responseFormat.name !== undefined ||
          options.responseFormat.description !== undefined
        ) {
          warnings.push({
            type: "unsupported",
            feature: "responseFormat schema/name/description - only basic JSON mode is supported",
          });
        }
      }
    }

    // Prepare tools
    const tools: ZaiChatRequest["tools"] = [];

    if (providerOptions.web_search != null) {
      tools.push({
        type: "web_search",
        web_search: providerOptions.web_search,
      });
    }

    if (providerOptions.retrieval != null) {
      tools.push({
        type: "retrieval",
        retrieval: providerOptions.retrieval,
      });
    }

    if (options.tools !== undefined) {
      for (const tool of options.tools) {
        if (tool.type === "function") {
          tools.push({
            type: "function",
            function: {
              name: tool.name ?? "",
              description: tool.description ?? "",
              parameters: tool.inputSchema,
            },
          } as ZaiTool);
        } else if (tool.type === "provider") {
          // Handle provider tools (web_search, retrieval)
          const toolId = (tool.id ?? tool.name) as string;
          if (toolId.includes("web_search") || toolId === "web_search") {
            tools.push({
              type: "web_search",
              web_search: tool.args,
            } as ZaiTool);
          } else if (toolId.includes("retrieval") || toolId === "retrieval") {
            tools.push({
              type: "retrieval",
              retrieval: tool.args,
            } as ZaiTool);
          } else {
            warnings.push({
              type: "unsupported",
              feature: `provider tool: ${toolId}`,
            });
          }
        }
      }
    }

    // Tool choice pass-through
    let tool_choice: ZaiChatRequest["tool_choice"] = undefined;
    if (options.toolChoice !== undefined) {
      if (options.toolChoice.type === "auto") {
        tool_choice = "auto";
      } else if (options.toolChoice.type === "none") {
        tool_choice = "none";
      } else if (options.toolChoice.type === "required") {
        tool_choice = "required";
      } else if (options.toolChoice.type === "tool") {
        tool_choice = {
          type: "function",
          function: { name: options.toolChoice.toolName },
        };
      }
    }

    // Strip data:image/*;base64, prefix from image URLs
    const processedMessages = messages.map(msg => {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map(part => {
            if (part.type === "image_url") {
              const url = part.image_url.url;
              const normalizedUrl = url.replace(/^data:image\/[^;]+;base64,/, "");
              return {
                type: "image_url" as const,
                image_url: { url: normalizedUrl },
              };
            }
            return part;
          }),
        };
      }
      return msg;
    });

    const hasTools = tools.length > 0;

    const thinking =
      providerOptions.thinking?.type != null
        ? {
            type: providerOptions.thinking.type,
            clear_thinking: providerOptions.thinking.clear_thinking,
          }
        : undefined;

    const args: ZaiChatRequest = {
      model: this.modelId,
      messages: processedMessages,
      temperature,
      top_p: topP,
      max_tokens: options.maxOutputTokens,
      seed: options.seed ?? providerOptions.seed,
      stop: options.stopSequences,
      stream: false, // Will be overridden in doStream
      thinking,
      tool_stream: providerOptions.tool_stream,
      tools: hasTools ? tools : undefined,
      tool_choice: hasTools ? tool_choice : undefined,
      response_format,
      user_id: providerOptions.user_id,
      do_sample: doSample,
      request_id: providerOptions.request_id,
      meta: providerOptions.meta,
      sensitive_word_check: providerOptions.sensitive_word_check,
      watermark_enabled: providerOptions.watermark_enabled,
      extra: providerOptions.extra,
    };

    return { args, warnings };
  }
}

function convertZaiChatUsage(
  usage: ZaiChatResponse["usage"] | undefined
): LanguageModelV3GenerateResult["usage"] {
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
      cacheRead: cachedTokens > 0 ? cachedTokens : undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: completionTokens,
      text: completionTokens - reasoningTokens,
      reasoning: reasoningTokens > 0 ? reasoningTokens : undefined,
    },
    raw: usage as unknown as LanguageModelV3GenerateResult["usage"]["raw"],
  };
}

function mapZaiFinishReason(
  finishReason: string
): LanguageModelV3GenerateResult["finishReason"]["unified"] {
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
