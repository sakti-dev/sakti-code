import { AnthropicProviderAdapter } from "./adapters/anthropic";
import type { ProviderAdapter } from "./adapters/base";
import { OpenAIProviderAdapter } from "./adapters/openai";
import { ZaiProviderAdapter } from "./adapters/zai";
import type { ProviderDescriptor } from "./types";

export interface ProviderRegistry {
  adapters: Map<string, ProviderAdapter>;
}

let defaultRegistry: ProviderRegistry | null = null;

export function createProviderRegistry(): ProviderRegistry {
  const adapters = new Map<string, ProviderAdapter>();
  const zai = new ZaiProviderAdapter();
  const openai = new OpenAIProviderAdapter();
  const anthropic = new AnthropicProviderAdapter();
  adapters.set(zai.id, zai);
  adapters.set(openai.id, openai);
  adapters.set(anthropic.id, anthropic);

  return { adapters };
}

function getDefaultRegistry(): ProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createProviderRegistry();
  }

  return defaultRegistry;
}

export function listProviderDescriptors(): ProviderDescriptor[] {
  return Array.from(getDefaultRegistry().adapters.values(), adapter => adapter.describe());
}

export function resolveProviderAdapter(id: string): ProviderAdapter | undefined {
  return getDefaultRegistry().adapters.get(id);
}
