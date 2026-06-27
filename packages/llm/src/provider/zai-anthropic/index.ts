import {
  type FetchFunction,
  withUserAgentSuffix,
} from "@ai-sdk/provider-utils";
import type {
  ProviderFactory,
  ProviderFactoryOptions,
  ProviderSDK,
} from "../registry.ts";
import { ZaiAnthropicLanguageModel } from "./zai-anthropic-language-model.ts";

/**
 * # createZaiAnthropic — factory for the hand-rolled Z.ai Anthropic provider
 *
 * Registered in `BUNDLED_PROVIDERS` under `"@sakti-code/zai-anthropic"`. The
 * catalog converter repoints `zai` + `zai-coding-plan` to this npm id, so the
 * factory is invoked with `apiKey` resolved from `auth.json` and `baseURL`
 * pointing at the Anthropic-compatible Z.ai endpoint.
 *
 * Sends `x-api-key` + `anthropic-version: 2023-06-01` on every request.
 * `anthropic-beta: prompt-caching-2024-07-31` is added by the model when
 * caching is on (the **only** beta we emit — see design doc §"Endpoint &
 * headers").
 */

const VERSION = "0.0.1";
const PROVIDER_NAME = "zai.messages";

const TRAILING_SLASH_PATTERN = /\/+$/;

export interface ZaiAnthropicProviderSettings extends ProviderFactoryOptions {
  fetch?: FetchFunction;
}

export function createZaiAnthropic(
  options: ZaiAnthropicProviderSettings
): ProviderSDK {
  const baseURL = (options.baseURL ?? "").replace(TRAILING_SLASH_PATTERN, "");
  const apiKey = options.apiKey ?? "";
  const headers = async () =>
    withUserAgentSuffix(
      {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(options.headers ?? {}),
      },
      `ai-sdk/zai-anthropic/${VERSION}`
    );

  return {
    languageModel: (modelId: string) =>
      new ZaiAnthropicLanguageModel(modelId, {
        baseURL,
        provider: PROVIDER_NAME,
        headers,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
  };
}

export type { ProviderFactory };
export { createZaiAnthropic as createZaiAnthropicProvider };
