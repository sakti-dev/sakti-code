import type {
  JSONSchema7,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FunctionTool,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
  SharedV4Warning,
} from "@ai-sdk/provider";
import {
  type FetchFunction,
  parseProviderOptions,
} from "@ai-sdk/provider-utils";
import {
  convertToZaiPrompt,
  type ZaiMessage,
} from "./convert-to-zai-prompt.ts";
import { CacheControlValidator } from "./get-cache-control.ts";
import { sanitizeJsonSchema } from "./sanitize-json-schema.ts";
import type { ZaiCacheControl } from "./zai-api.ts";
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
  provider: string;
}

const SUPPORTED_HTTPS_URL_PATTERN = /^https?:\/\/.*$/;
const SUPPORTED_DATA_IMAGE_URL_PATTERN = /^data:image\/.*$/;

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

  doGenerate(
    _options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4GenerateResult> {
    return Promise.reject(
      new Error("ZaiLanguageModel.doGenerate: not implemented")
    );
  }

  doStream(
    _options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4StreamResult> {
    return Promise.reject(
      new Error("ZaiLanguageModel.doStream: not implemented")
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
  const maxTokens = input.maxOutputTokens + (input.thinking?.budget ?? 0);

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
