import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";

/**
 * # ZaiAnthropicLanguageModel — hand-rolled Anthropic Messages provider for Z.ai
 *
 * Speaks the Anthropic Messages protocol to Z.ai's Anthropic-compatible
 * endpoint (`https://api.z.ai/api/anthropic/v1/messages`), with first-class
 * support for Z.ai-native extensions (`speed`, `output_config`), leveled
 * thinking budgets, prompt caching, and interleaved reasoning.
 *
 * Ported in spirit from `@ai-sdk/anthropic` (reference under
 * `openspec/references/ai/packages/anthropic/src/`) but stripped to the minimal
 * Anthropic subset Z.ai surfaces. See
 * `docs/plans/2026-06-28-zai-anthropic-provider-design.md`.
 */

export interface ZaiAnthropicConfig {
  baseURL: string;
  fetch?: FetchFunction;
  headers: () => Promise<Record<string, string | undefined>>;
  provider: string;
}

const SUPPORTED_HTTPS_URL_PATTERN = /^https?:\/\/.*$/;
const SUPPORTED_DATA_IMAGE_URL_PATTERN = /^data:image\/.*$/;

export class ZaiAnthropicLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly modelId: string;
  private readonly config: ZaiAnthropicConfig;

  constructor(modelId: string, config: ZaiAnthropicConfig) {
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

  doGenerate(
    _options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4GenerateResult> {
    return Promise.reject(
      new Error("ZaiAnthropicLanguageModel.doGenerate: not implemented")
    );
  }

  doStream(
    _options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4StreamResult> {
    return Promise.reject(
      new Error("ZaiAnthropicLanguageModel.doStream: not implemented")
    );
  }
}
