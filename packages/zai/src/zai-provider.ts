import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import {
  loadApiKey,
  loadOptionalSetting,
  withoutTrailingSlash,
  withUserAgentSuffix,
} from "@ai-sdk/provider-utils";
import type { ZaiChatModelId } from "./chat/zai-chat-settings";
import { VERSION } from "./version";
import { ZaiChatLanguageModel } from "./zai-chat-language-model";
import {
  DEFAULT_ACCEPT_LANGUAGE,
  DEFAULT_CODING_BASE_URL,
  DEFAULT_GENERAL_BASE_URL,
  DEFAULT_SOURCE_CHANNEL,
} from "./zai-constants";
import { getZaiAuthorizationHeader } from "./zai-jwt";

export interface ZaiProvider extends ProviderV3 {
  (modelId: ZaiChatModelId): LanguageModelV3;
  languageModel(modelId: ZaiChatModelId): LanguageModelV3;
  chat(modelId: ZaiChatModelId): LanguageModelV3;
  embeddingModel(modelId: string): EmbeddingModelV3;
  imageModel(modelId: string): ImageModelV3;
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
    options.endpoint === "coding" ? DEFAULT_CODING_BASE_URL : DEFAULT_GENERAL_BASE_URL;

  const baseURL = withoutTrailingSlash(
    options.baseURL ??
      loadOptionalSetting({
        settingValue: options.baseURL,
        environmentVariableName: "ZAI_BASE_URL",
      }) ??
      endpointBaseURL
  );

  const getHeaders = async () => {
    const apiKey = loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: "ZAI_API_KEY",
      description: "Z.ai",
    });

    return withUserAgentSuffix(
      {
        Authorization: await getZaiAuthorizationHeader(apiKey),
        "x-source-channel": options.sourceChannel ?? DEFAULT_SOURCE_CHANNEL,
        "Accept-Language": DEFAULT_ACCEPT_LANGUAGE,
        ...options.headers,
      },
      `ai-sdk/zai/${VERSION}`
    );
  };

  const createChatModel = (modelId: ZaiChatModelId) =>
    new ZaiChatLanguageModel(modelId, {
      provider: "zai.chat",
      url: ({ path }: { path: string }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const provider = function (modelId: ZaiChatModelId): LanguageModelV3 {
    return createChatModel(modelId);
  };

  provider.specificationVersion = "v3" as const;
  provider.languageModel = createChatModel;
  provider.chat = createChatModel;
  provider.embeddingModel = () => {
    throw new Error("Z.ai does not support embedding models.");
  };
  provider.imageModel = () => {
    throw new Error("Z.ai does not support image models.");
  };

  return provider as ZaiProvider;
}

/**
 * Default Zai provider instance.
 */
export const zai = createZai();
