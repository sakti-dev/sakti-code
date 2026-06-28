import type {
  JSONSchema7,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FunctionTool,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  SharedV4Warning,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  type FetchFunction,
  type ParseResult,
  parseProviderOptions,
  postJsonToApi,
} from "@ai-sdk/provider-utils";
import type { z } from "zod/v4";
import {
  convertToZaiPrompt,
  type ZaiMessage,
} from "./convert-to-zai-prompt.ts";
import { convertZaiUsage } from "./convert-zai-usage.ts";
import { CacheControlValidator } from "./get-cache-control.ts";
import { mapZaiResponse } from "./map-zai-response.ts";
import { mapZaiStopReason } from "./map-zai-stop-reason.ts";
import { sanitizeJsonSchema } from "./sanitize-json-schema.ts";
import type { ZaiCacheControl, ZaiUsage } from "./zai-api.ts";
import { zaiChunkZod, zaiResponseZod } from "./zai-api.ts";
import { zaiFailedResponseHandler } from "./zai-error.ts";
import { type ZaiOptions, zaiOptions } from "./zai-options.ts";

/**
 * # ZaiLanguageModel — hand-rolled Anthropic Messages provider for Z.ai
 *
 * Ported from `@ai-sdk/anthropic` (reference under
 * `openspec/references/ai/packages/anthropic/src/anthropic-language-model.ts`)
 * and stripped to the minimal Anthropic subset Z.ai surfaces. See
 * `docs/plans/2026-06-28-zai-anthropic-provider-design.md`.
 *
 * Out of scope (intentionally unsupported): mcp/container/code-exec/web/
 * advisor/tool-search/fallback/compaction/citations, mid-conversation system,
 * Claude-era betas, model-capabilities table. Z.ai surfaces none of these.
 */

export interface ZaiLanguageModelConfig {
  baseURL: string;
  fetch?: FetchFunction;
  headers: () => Promise<Record<string, string | undefined>>;
  /**
   * Model output-token ceiling (`Model.maxTokens` from the catalog). When
   * set, `max_tokens` is capped at `maxTokens - SUMMARY_RESERVE` so the
   * agent loop has room for compaction output (per
   * `zcode-glm-best-practices.md §4`).
   */
  maxTokens?: number;
  provider: string;
}

const SUPPORTED_HTTPS_URL_PATTERN = /^https?:\/\/.*$/;
const SUPPORTED_DATA_IMAGE_URL_PATTERN = /^data:image\/.*$/;

/**
 * Tokens reserved at the top of `max_tokens` for compaction/summary output.
 * Per `zcode-glm-best-practices.md §4`: ZCode computes
 * `maxOutputTokens = min(requested, modelLimit, modelLimit − summaryReserve)`
 * so there's always headroom for compaction. 4000 ≈ ZCode's observed value.
 */
const SUMMARY_RESERVE = 4000;

/** Hand-written snake_case wire shape for the Anthropic Messages body. */
export interface ZaiRequest {
  max_tokens: number;
  messages: ZaiMessage[];
  model: string;
  output_config?: {
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    format?: { type: "json_schema"; schema: unknown };
    task_budget?: {
      remaining?: number;
      total: number;
      type: "tokens";
    };
  };
  speed?: "fast" | "standard";
  stop_sequences?: string[];
  stream?: true;
  system?: Array<{
    cache_control?: ZaiCacheControl;
    text: string;
    type: "text";
  }>;
  temperature?: number;
  thinking?: {
    budget_tokens?: number;
    display?: "omitted" | "summarized";
    type: "enabled" | "disabled" | "adaptive";
  };
  tool_choice?: { name?: string; type: "auto" | "any" | "tool" };
  tools?: ZaiTool[];
  top_k?: number;
  top_p?: number;
}

interface ZaiTool {
  cache_control?: ZaiCacheControl;
  description?: string;
  input_schema: object;
  name: string;
}

/** Result of {@link ZaiLanguageModel#getArgs}. */
export interface ZaiGetArgsResult {
  args: ZaiRequest;
  betas: Set<string>;
  warnings: SharedV4Warning[];
}

export class ZaiLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly modelId: string;
  private readonly config: ZaiLanguageModelConfig;

  constructor(modelId: string, config: ZaiLanguageModelConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  supportsUrl(url: URL): boolean {
    return url.protocol === "https:";
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return {
      "image/*": [
        SUPPORTED_HTTPS_URL_PATTERN,
        SUPPORTED_DATA_IMAGE_URL_PATTERN,
      ],
    };
  }

  /**
   * Build the Anthropic Messages request body from V4 call options.
   *
   * Ported from `@ai-sdk/anthropic`'s `getArgs` (anthropic-language-model.ts
   * :203-780), stripped to v1 scope. See design doc §"Request building".
   *
   * Public for TDD; the surface used by `doGenerate`/`doStream` is stable.
   */
  async getArgs(
    options: LanguageModelV4CallOptions
  ): Promise<ZaiGetArgsResult> {
    const warnings: SharedV4Warning[] = [];
    const betas = new Set<string>();

    const {
      prompt,
      maxOutputTokens,
      temperature,
      topP,
      topK,
      frequencyPenalty,
      presencePenalty,
      stopSequences,
      seed,
      tools,
      toolChoice,
      providerOptions,
    } = options;

    if (frequencyPenalty != null) {
      warnings.push({ type: "unsupported", feature: "frequencyPenalty" });
    }
    if (presencePenalty != null) {
      warnings.push({ type: "unsupported", feature: "presencePenalty" });
    }
    if (seed != null) {
      warnings.push({ type: "unsupported", feature: "seed" });
    }

    const zaiProviderOptions = await parseProviderOptions({
      provider: "zai",
      providerOptions,
      schema: zaiOptions,
    });

    const sendReasoning = zaiProviderOptions?.sendReasoning ?? true;
    const cacheControlValidator = new CacheControlValidator();
    const { system, messages } = convertToZaiPrompt({ prompt, sendReasoning });

    // ─── thinking ────────────────────────────────────────────────────────
    const thinkingType = zaiProviderOptions?.thinking?.type;
    const isThinking =
      thinkingType === "enabled" || thinkingType === "adaptive";
    let thinkingBudget =
      thinkingType === "enabled"
        ? zaiProviderOptions?.thinking?.budgetTokens
        : undefined;
    const thinkingDisplay =
      thinkingType === "adaptive"
        ? zaiProviderOptions?.thinking?.display
        : undefined;

    if (isThinking && thinkingType === "enabled" && thinkingBudget == null) {
      warnings.push({
        type: "compatibility",
        feature: "extended thinking",
        details:
          "thinking budget is required when thinking is enabled. using default budget of 1024 tokens.",
      });
      thinkingBudget = 1024;
    }

    // ─── temperature / topP / topK strip when thinking ───────────────────
    const sampling = stripSamplingWhenThinking(
      { temperature, topP, topK },
      isThinking,
      warnings
    );

    // ─── prompt-caching: mark last system block + last tool ──────────────
    const cacheConfig = zaiProviderOptions?.cacheControl;
    const cachedSystem = stampSystemCacheControl(
      system,
      cacheConfig?.system ?? true,
      cacheControlValidator
    );
    if (cachedSystem) {
      betas.add("prompt-caching-2024-07-31");
    }

    const functionTools = (tools ?? []).filter(
      (t): t is LanguageModelV4FunctionTool => t.type === "function"
    );
    const zaiTools = prepareTools(
      functionTools,
      cacheControlValidator,
      cacheConfig?.tools ?? true
    );
    if (zaiTools && zaiTools.length > 0) {
      betas.add("prompt-caching-2024-07-31");
    }

    // ─── assemble body ───────────────────────────────────────────────────
    const args = assembleZaiRequest({
      maxOutputTokens: maxOutputTokens ?? 4096,
      maxTokensCap: this.config.maxTokens,
      messages,
      modelId: this.modelId,
      outputConfig: buildOutputConfig(zaiProviderOptions),
      sampling,
      speed: zaiProviderOptions?.speed,
      stopSequences,
      system,
      thinking:
        isThinking &&
        (thinkingType === "enabled" || thinkingType === "adaptive")
          ? {
              type: thinkingType,
              budget: thinkingBudget,
              display: thinkingDisplay,
            }
          : undefined,
      tools: zaiTools,
      toolChoice,
    });

    return {
      args,
      betas,
      warnings: [...warnings, ...cacheControlValidator.getWarnings()],
    };
  }

  async doGenerate(
    options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4GenerateResult> {
    const { args, warnings, betas } = await this.getArgs(options);

    const { value: response, responseHeaders } = await postJsonToApi({
      url: this.buildRequestUrl(false),
      headers: await this.getHeaders(betas, options.headers),
      body: args,
      failedResponseHandler: zaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(zaiResponseZod),
      ...(options.abortSignal === undefined
        ? {}
        : { abortSignal: options.abortSignal }),
      ...(this.config.fetch === undefined ? {} : { fetch: this.config.fetch }),
    });

    const mapped = mapZaiResponse({ response });
    const result: LanguageModelV4GenerateResult = {
      content: mapped.content,
      finishReason: mapped.finishReason,
      usage: mapped.usage,
      warnings: [...warnings, ...mapped.warnings],
      request: { body: args },
    };
    if (mapped.response !== undefined) {
      result.response = {
        ...mapped.response,
        body: response,
        ...(responseHeaders === undefined ? {} : { headers: responseHeaders }),
      };
    }
    return result;
  }

  async doStream(
    options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4StreamResult> {
    const { args, warnings, betas } = await this.getArgs(options);
    const body = { ...args, stream: true as const };

    const { value: response, responseHeaders } = await postJsonToApi({
      url: this.buildRequestUrl(true),
      headers: await this.getHeaders(betas, options.headers),
      body,
      failedResponseHandler: zaiFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(zaiChunkZod),
      ...(options.abortSignal === undefined
        ? {}
        : { abortSignal: options.abortSignal }),
      ...(this.config.fetch === undefined ? {} : { fetch: this.config.fetch }),
    });

    const stream = pipeThroughZaiStream(
      response,
      warnings,
      options.includeRawChunks ?? false
    );

    const result: LanguageModelV4StreamResult = {
      stream,
      request: { body },
    };
    if (responseHeaders !== undefined) {
      result.response = { headers: responseHeaders };
    }
    return result;
  }

  private buildRequestUrl(_isStreaming: boolean): string {
    return `${this.config.baseURL}/v1/messages`;
  }

  private async getHeaders(
    betas: Set<string>,
    requestHeaders: Record<string, string | undefined> | undefined
  ): Promise<Record<string, string | undefined>> {
    const config = await this.config.headers();
    return combineHeaders(
      config,
      requestHeaders,
      betas.size > 0 ? { "anthropic-beta": [...betas].join(",") } : {}
    );
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

interface SystemBlock {
  cache_control?: ZaiCacheControl;
  text: string;
  type: "text";
}

function stampCacheControl(block: SystemBlock, marker: ZaiCacheControl): void {
  block.cache_control = marker;
}

/**
 * Stamp the last system text block with an ephemeral cache breakpoint.
 * Returns `true` when a breakpoint was actually placed (caller records the
 * `prompt-caching-2024-07-31` beta).
 */
function stampSystemCacheControl(
  system: SystemBlock[] | undefined,
  enabled: boolean,
  validator: CacheControlValidator
): boolean {
  if (!system || system.length === 0 || !enabled) {
    return false;
  }
  const breakpoint = validator.addBreakpoint();
  if (!breakpoint) {
    return false;
  }
  const last = system.at(-1);
  if (last) {
    stampCacheControl(last, breakpoint);
  }
  return true;
}

interface AssembleInput {
  maxOutputTokens: number;
  /**
   * Model output-token ceiling (`Model.maxTokens`). When set, the effective
   * `max_tokens` is capped at `maxTokensCap − SUMMARY_RESERVE` to leave room
   * for compaction output (per `zcode-glm-best-practices.md §4`).
   */
  maxTokensCap: number | undefined;
  messages: ZaiMessage[];
  modelId: string;
  outputConfig: ZaiRequest["output_config"];
  sampling: SamplingParams;
  speed: "fast" | "standard" | undefined;
  stopSequences: string[] | undefined;
  system: SystemBlock[] | undefined;
  thinking:
    | {
        budget: number | undefined;
        display: "omitted" | "summarized" | undefined;
        type: "enabled" | "adaptive";
      }
    | undefined;
  toolChoice: LanguageModelV4CallOptions["toolChoice"];
  tools: ZaiTool[] | undefined;
}

function assembleZaiRequest(input: AssembleInput): ZaiRequest {
  const isThinking = input.thinking !== undefined;
  // Anthropic's `thinking.budget_tokens` is a *portion of* `max_tokens` (the
  // thinking tokens come out of the total), not additive. Z.ai enforces a
  // strict 1..modelMax cap and rejects sums. Per `zcode-glm-best-practices.md
  // §4`, also reserve `SUMMARY_RESERVE` tokens at the top for compaction
  // output so the agent loop has headroom.
  const cap = input.maxTokensCap;
  const effectiveCap =
    cap === undefined ? undefined : Math.max(1, cap - SUMMARY_RESERVE);
  const maxTokens =
    effectiveCap === undefined
      ? input.maxOutputTokens
      : Math.min(input.maxOutputTokens, effectiveCap);

  const args: ZaiRequest = {
    max_tokens: maxTokens,
    messages: input.messages,
    model: input.modelId,
  };
  if (input.outputConfig !== undefined) {
    args.output_config = input.outputConfig;
  }
  if (input.speed !== undefined) {
    args.speed = input.speed;
  }
  if (input.stopSequences && input.stopSequences.length > 0) {
    args.stop_sequences = input.stopSequences;
  }
  if (input.system && input.system.length > 0) {
    args.system = input.system;
  }
  if (input.sampling.temperature !== undefined) {
    args.temperature = input.sampling.temperature;
  }
  if (isThinking && input.thinking) {
    args.thinking = {
      type: input.thinking.type,
      ...(input.thinking.budget === undefined
        ? {}
        : { budget_tokens: input.thinking.budget }),
      ...(input.thinking.display === undefined
        ? {}
        : { display: input.thinking.display }),
    };
  }
  if (input.toolChoice !== undefined) {
    args.tool_choice = mapToolChoice(input.toolChoice);
  }
  if (input.tools && input.tools.length > 0) {
    args.tools = input.tools;
  }
  if (input.sampling.topK !== undefined) {
    args.top_k = input.sampling.topK;
  }
  if (input.sampling.topP !== undefined) {
    args.top_p = input.sampling.topP;
  }
  return args;
}

function prepareTools(
  tools: LanguageModelV4FunctionTool[] | undefined,
  validator: CacheControlValidator,
  cacheTools: boolean
): ZaiTool[] | undefined {
  if (!tools || tools.length === 0) {
    return;
  }
  const prepared: ZaiTool[] = tools.map((tool) => ({
    name: tool.name,
    ...(tool.description === undefined
      ? {}
      : { description: tool.description }),
    input_schema: sanitizeJsonSchema(tool.inputSchema as JSONSchema7),
  }));
  if (cacheTools && prepared.length > 0) {
    const breakpoint = validator.addBreakpoint();
    if (breakpoint) {
      const last = prepared.at(-1);
      if (last) {
        last.cache_control = breakpoint;
      }
    }
  }
  return prepared;
}

function buildOutputConfig(
  zaiProviderOptions: ZaiOptions | undefined
): ZaiRequest["output_config"] | undefined {
  const cfg = zaiProviderOptions?.outputConfig;
  if (cfg === undefined) {
    return;
  }
  const hasAny =
    cfg.effort !== undefined ||
    cfg.taskBudget !== undefined ||
    cfg.format !== undefined;
  if (!hasAny) {
    return;
  }
  return {
    ...(cfg.effort === undefined ? {} : { effort: cfg.effort }),
    ...(cfg.taskBudget === undefined
      ? {}
      : {
          task_budget: {
            type: "tokens",
            total: cfg.taskBudget.total,
            ...(cfg.taskBudget.remaining === undefined
              ? {}
              : { remaining: cfg.taskBudget.remaining }),
          },
        }),
    ...(cfg.format === undefined
      ? {}
      : {
          format: { type: "json_schema" as const, schema: cfg.format.schema },
        }),
  };
}

function mapToolChoice(
  choice: NonNullable<LanguageModelV4CallOptions["toolChoice"]>
): NonNullable<ZaiRequest["tool_choice"]> {
  switch (choice.type) {
    case "auto":
      return { type: "auto" };
    case "none":
      // Anthropic has no "none" tool_choice; the cleanest equivalent is "auto"
      // with no tools. We map to "auto" here — the agent loop only uses "none"
      // when it also strips tools from the call site.
      return { type: "auto" };
    case "required":
      return { type: "any" };
    case "tool":
      return { type: "tool", name: choice.toolName };
  }
}

interface SamplingParams {
  temperature: number | undefined;
  topK: number | undefined;
  topP: number | undefined;
}

/**
 * GLM rejects sampling params while thinking is enabled. Returns the (possibly
 * stripped) sampling values; pushes one `unsupported` warning per dropped
 * field. When thinking is off, returns the inputs unchanged.
 */
function stripSamplingWhenThinking(
  params: SamplingParams,
  isThinking: boolean,
  warnings: SharedV4Warning[]
): SamplingParams {
  if (!isThinking) {
    return params;
  }
  const result: SamplingParams = {
    temperature: undefined,
    topK: undefined,
    topP: undefined,
  };
  for (const key of ["temperature", "topK", "topP"] as const) {
    if (params[key] === undefined) {
      continue;
    }
    warnings.push({
      type: "unsupported",
      feature: key,
      details: `${key} is not supported when thinking is enabled`,
    });
  }
  return result;
}

// ─── doStream: SSE → V4 stream parts ─────────────────────────────────────────

type ZaiStreamBlock =
  | { type: "text" }
  | { type: "reasoning" }
  | {
      firstDelta: boolean;
      input: string;
      name: string;
      toolCallId: string;
      type: "tool-call";
    };

interface ZaiStreamState {
  blocks: Map<number, ZaiStreamBlock>;
  blockType: "text" | "thinking" | "redacted_thinking" | "tool_use" | undefined;
  finishReasonRaw: string | undefined;
  finishReasonUnified:
    | "stop"
    | "length"
    | "content-filter"
    | "tool-calls"
    | "error"
    | "other";
  usage: ZaiUsage;
}

interface ZaiStreamCtx {
  includeRawChunks: boolean;
  state: ZaiStreamState;
}

type StreamController =
  TransformStreamDefaultController<LanguageModelV4StreamPart>;

type ZaiChunk = z.infer<typeof zaiChunkZod>;

function pipeThroughZaiStream(
  response: ReadableStream<ParseResult<unknown>>,
  warnings: SharedV4Warning[],
  includeRawChunks: boolean
): ReadableStream<LanguageModelV4StreamPart> {
  const state: ZaiStreamState = {
    blocks: new Map(),
    blockType: undefined,
    finishReasonUnified: "other",
    finishReasonRaw: undefined,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
  const ctx: ZaiStreamCtx = { state, includeRawChunks };
  return response.pipeThrough(
    new TransformStream<ParseResult<unknown>, LanguageModelV4StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings });
      },
      transform: (chunk, controller) =>
        transformZaiChunk(ctx, chunk, controller),
    })
  );
}

function transformZaiChunk(
  ctx: ZaiStreamCtx,
  chunk: ParseResult<unknown>,
  controller: StreamController
): void {
  const { state, includeRawChunks } = ctx;
  if (includeRawChunks) {
    controller.enqueue({ type: "raw", rawValue: chunk.rawValue });
  }
  if (!chunk.success) {
    controller.enqueue({ type: "error", error: chunk.error });
    state.finishReasonUnified = "error";
    return;
  }
  const value = zaiChunkZod.parse(chunk.value) as ZaiChunk;
  switch (value.type) {
    case "ping":
      return;
    case "message_start":
      handleMessageStart(value, state, controller);
      return;
    case "content_block_start":
      handleContentBlockStart(value, state, controller);
      return;
    case "content_block_delta":
      handleContentBlockDelta(value, state, controller);
      return;
    case "content_block_stop":
      handleContentBlockStop(value, state, controller);
      return;
    case "message_delta":
      handleMessageDelta(value, state);
      return;
    case "message_stop":
      controller.enqueue({
        type: "finish",
        finishReason: {
          unified: state.finishReasonUnified,
          raw: state.finishReasonRaw,
        },
        usage: convertZaiUsage({ usage: state.usage }),
      });
      return;
    case "error":
      controller.enqueue({ type: "error", error: value.error });
      state.finishReasonUnified = "error";
      return;
  }
}

function handleMessageStart(
  value: Extract<ZaiChunk, { type: "message_start" }>,
  state: ZaiStreamState,
  controller: StreamController
): void {
  const msgUsage = value.message.usage;
  if (msgUsage) {
    state.usage.input_tokens = msgUsage.input_tokens;
    state.usage.cache_creation_input_tokens =
      msgUsage.cache_creation_input_tokens ?? 0;
    state.usage.cache_read_input_tokens = msgUsage.cache_read_input_tokens ?? 0;
  }
  controller.enqueue({
    type: "response-metadata",
    ...(value.message.id !== undefined && value.message.id !== null
      ? { id: value.message.id }
      : {}),
    ...(value.message.model !== undefined && value.message.model !== null
      ? { modelId: value.message.model }
      : {}),
  });
}

function handleContentBlockStart(
  value: Extract<ZaiChunk, { type: "content_block_start" }>,
  state: ZaiStreamState,
  controller: StreamController
): void {
  const part = value.content_block;
  state.blockType = part.type;
  if (part.type === "text") {
    state.blocks.set(value.index, { type: "text" });
    controller.enqueue({ type: "text-start", id: String(value.index) });
    return;
  }
  if (part.type === "thinking") {
    state.blocks.set(value.index, { type: "reasoning" });
    controller.enqueue({ type: "reasoning-start", id: String(value.index) });
    return;
  }
  if (part.type === "redacted_thinking") {
    state.blocks.set(value.index, { type: "reasoning" });
    controller.enqueue({
      type: "reasoning-start",
      id: String(value.index),
      providerMetadata: { zai: { redactedData: part.data } },
    });
    return;
  }
  const initialInput =
    part.input !== undefined &&
    typeof part.input === "object" &&
    Object.keys(part.input as object).length > 0
      ? JSON.stringify(part.input)
      : "";
  state.blocks.set(value.index, {
    type: "tool-call",
    toolCallId: part.id,
    name: part.name,
    input: initialInput,
    firstDelta: initialInput.length === 0,
  });
  controller.enqueue({
    type: "tool-input-start",
    id: part.id,
    toolName: part.name,
  });
}

function handleContentBlockDelta(
  value: Extract<ZaiChunk, { type: "content_block_delta" }>,
  state: ZaiStreamState,
  controller: StreamController
): void {
  const delta = value.delta;
  if (delta.type === "text_delta") {
    controller.enqueue({
      type: "text-delta",
      id: String(value.index),
      delta: delta.text,
    });
    return;
  }
  if (delta.type === "thinking_delta") {
    controller.enqueue({
      type: "reasoning-delta",
      id: String(value.index),
      delta: delta.thinking,
    });
    return;
  }
  if (delta.type === "signature_delta") {
    if (state.blockType === "thinking") {
      controller.enqueue({
        type: "reasoning-delta",
        id: String(value.index),
        delta: "",
        providerMetadata: { zai: { signature: delta.signature } },
      });
    }
    return;
  }
  const block = state.blocks.get(value.index);
  if (block?.type !== "tool-call") {
    return;
  }
  controller.enqueue({
    type: "tool-input-delta",
    id: block.toolCallId,
    delta: delta.partial_json,
  });
  block.input += delta.partial_json;
  block.firstDelta = false;
}

function handleContentBlockStop(
  value: Extract<ZaiChunk, { type: "content_block_stop" }>,
  state: ZaiStreamState,
  controller: StreamController
): void {
  const block = state.blocks.get(value.index);
  if (!block) {
    state.blockType = undefined;
    return;
  }
  if (block.type === "text") {
    controller.enqueue({ type: "text-end", id: String(value.index) });
  } else if (block.type === "reasoning") {
    controller.enqueue({ type: "reasoning-end", id: String(value.index) });
  } else {
    controller.enqueue({ type: "tool-input-end", id: block.toolCallId });
    const finalInput = block.input === "" ? "{}" : block.input;
    controller.enqueue({
      type: "tool-call",
      toolCallId: block.toolCallId,
      toolName: block.name,
      input: finalInput,
    });
  }
  state.blocks.delete(value.index);
  state.blockType = undefined;
}

function handleMessageDelta(
  value: Extract<ZaiChunk, { type: "message_delta" }>,
  state: ZaiStreamState
): void {
  if (value.usage) {
    if (
      value.usage.input_tokens !== undefined &&
      value.usage.input_tokens !== null
    ) {
      state.usage.input_tokens = value.usage.input_tokens;
    }
    state.usage.output_tokens = value.usage.output_tokens;
    if (value.usage.cache_read_input_tokens !== undefined) {
      state.usage.cache_read_input_tokens =
        value.usage.cache_read_input_tokens ?? 0;
    }
    if (value.usage.cache_creation_input_tokens !== undefined) {
      state.usage.cache_creation_input_tokens =
        value.usage.cache_creation_input_tokens ?? 0;
    }
  }
  state.finishReasonUnified = mapZaiStopReason({
    finishReason: value.delta.stop_reason,
  });
  state.finishReasonRaw = value.delta.stop_reason ?? undefined;
}
