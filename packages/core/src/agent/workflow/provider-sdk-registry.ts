import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createCerebras } from "@ai-sdk/cerebras";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createVercel } from "@ai-sdk/vercel";
import { createXai } from "@ai-sdk/xai";
import { createGitLab } from "@gitlab/gitlab-ai-provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export interface ProviderSdkOptions {
  providerId: string;
  providerNpmPackage?: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

export type ProviderSdkFactory = ReturnType<typeof createOpenAI>;

const SDK_CREATORS: Record<string, (options: Record<string, unknown>) => ProviderSdkFactory> = {
  "@ai-sdk/openai": createOpenAI as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/openai-compatible": createOpenAICompatible as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/anthropic": createAnthropic as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/azure": createAzure as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/amazon-bedrock": createAmazonBedrock as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/cerebras": createCerebras as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/cohere": createCohere as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/deepinfra": createDeepInfra as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/gateway": createGateway as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/google": createGoogleGenerativeAI as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/google-vertex": createVertex as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/google-vertex/anthropic": createVertexAnthropic as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/groq": createGroq as unknown as (options: Record<string, unknown>) => ProviderSdkFactory,
  "@ai-sdk/mistral": createMistral as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/perplexity": createPerplexity as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/togetherai": createTogetherAI as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/vercel": createVercel as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@ai-sdk/xai": createXai as unknown as (options: Record<string, unknown>) => ProviderSdkFactory,
  "@openrouter/ai-sdk-provider": createOpenRouter as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@gitlab/gitlab-ai-provider": createGitLab as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "@jerome-benoit/sap-ai-provider-v2": createOpenAICompatible as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "venice-ai-sdk-provider": createOpenAICompatible as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
  "ai-gateway-provider": createOpenAICompatible as unknown as (
    options: Record<string, unknown>
  ) => ProviderSdkFactory,
};

export function inferProviderNpmPackage(providerId: string): string | undefined {
  switch (providerId) {
    case "openai":
      return "@ai-sdk/openai";
    case "anthropic":
      return "@ai-sdk/anthropic";
    case "azure":
      return "@ai-sdk/azure";
    case "amazon-bedrock":
      return "@ai-sdk/amazon-bedrock";
    case "cerebras":
      return "@ai-sdk/cerebras";
    case "cohere":
      return "@ai-sdk/cohere";
    case "deepinfra":
      return "@ai-sdk/deepinfra";
    case "gateway":
      return "@ai-sdk/gateway";
    case "google":
      return "@ai-sdk/google";
    case "google-vertex":
      return "@ai-sdk/google-vertex";
    case "groq":
      return "@ai-sdk/groq";
    case "mistral":
      return "@ai-sdk/mistral";
    case "perplexity":
      return "@ai-sdk/perplexity";
    case "togetherai":
      return "@ai-sdk/togetherai";
    case "vercel":
      return "@ai-sdk/vercel";
    case "xai":
      return "@ai-sdk/xai";
    case "openrouter":
      return "@openrouter/ai-sdk-provider";
    case "gitlab":
      return "@gitlab/gitlab-ai-provider";
    default:
      return undefined;
  }
}

export function resolveProviderSdkFactory(input: ProviderSdkOptions): ProviderSdkFactory {
  const npmPackage = input.providerNpmPackage?.trim();
  const creator = npmPackage ? SDK_CREATORS[npmPackage] : undefined;
  const effectiveCreator = creator ?? createOpenAI;
  const shouldUseOpenAiEnvFallback =
    input.providerId === "openai" || npmPackage === "@ai-sdk/openai";

  const options: Record<string, unknown> = {
    name: input.providerId,
    apiKey:
      input.apiKey ?? (shouldUseOpenAiEnvFallback ? process.env.OPENAI_API_KEY : undefined) ?? "",
    baseURL: input.baseURL,
    headers: input.headers,
  };

  if (npmPackage === "@gitlab/gitlab-ai-provider") {
    options.instanceUrl = input.baseURL || "https://gitlab.com";
  }

  return effectiveCreator(options);
}
