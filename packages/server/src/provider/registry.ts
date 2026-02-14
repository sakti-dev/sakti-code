import type { ProviderAdapter } from "./adapters/base";
import { ZaiProviderAdapter } from "./adapters/zai";
import type { ProviderDescriptor } from "./types";

export interface ProviderRegistry {
  adapters: Map<string, ProviderAdapter>;
}

let defaultRegistry: ProviderRegistry | null = null;

export function createProviderRegistry(): ProviderRegistry {
  const adapters = new Map<string, ProviderAdapter>();
  const zai = new ZaiProviderAdapter();
  adapters.set(zai.id, zai);

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
