import { listProviderAuthMethods } from "./auth/oauth";
import type { ProviderAuthService } from "./auth/service";
import type { ModelDescriptor, ProviderAuthMethodDescriptor, ProviderDescriptor } from "./types";

export interface ProviderCatalogItem {
  id: string;
  name: string;
  aliases: string[];
  authMethods: ProviderAuthMethodDescriptor[];
  connected: boolean;
  modelCount: number;
  popular: boolean;
  supported?: boolean;
  note?: string;
}

const POPULAR_PROVIDER_IDS = new Set([
  "opencode",
  "zai",
  "zai-coding-plan",
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "moonshot",
]);

const PROVIDER_NOTES: Record<string, string> = {
  opencode: "Curated models including Claude, GPT, Gemini and more",
  zai: "Direct access to Z.AI GLM models",
  "zai-coding-plan": "Specialized package for coding plan workflows",
  openai: "GPT models for fast, capable general AI tasks",
  anthropic: "Direct access to Claude models",
  google: "Gemini models for structured and multimodal tasks",
  openrouter: "Access many models from one provider",
};

function titleCaseProviderId(providerId: string): string {
  return providerId
    .split(/[-_]/g)
    .map(part => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function providerAliases(providerId: string, providerName: string): string[] {
  const terms = new Set<string>([providerId.toLowerCase(), providerName.toLowerCase()]);

  if (providerId === "zai") {
    terms.add("z.ai");
    terms.add("z ai");
    terms.add("zen");
    terms.add("opencode zen");
  }

  if (providerId === "zai-coding-plan") {
    terms.add("z.ai coding plan");
    terms.add("zai coding plan");
    terms.add("coding plan");
  }

  if (providerId === "moonshot") {
    terms.add("kimi");
  }

  return Array.from(terms);
}

function sortCatalog(a: ProviderCatalogItem, b: ProviderCatalogItem): number {
  if (a.connected !== b.connected) return a.connected ? -1 : 1;
  if (a.popular !== b.popular) return a.popular ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function collectKnownProviderIds(input: {
  providers: ProviderDescriptor[];
  models: ModelDescriptor[];
}): Set<string> {
  const knownProviderIds = new Set<string>(input.providers.map(provider => provider.id));
  for (const model of input.models) {
    knownProviderIds.add(model.providerId);
  }
  return knownProviderIds;
}

export async function buildProviderCatalog(input: {
  providers: ProviderDescriptor[];
  models: ModelDescriptor[];
  authService: Pick<ProviderAuthService, "getState">;
}): Promise<ProviderCatalogItem[]> {
  const providerMeta = new Map<
    string,
    {
      name: string;
      modelCount: number;
      authMethods: ProviderAuthMethodDescriptor[];
      envVars: Set<string>;
    }
  >();

  for (const provider of input.providers) {
    providerMeta.set(provider.id, {
      name: provider.name,
      modelCount: 0,
      authMethods: [{ type: provider.auth?.kind ?? "token", label: "API Token" }],
      envVars: new Set(provider.env ?? []),
    });
  }

  for (const model of input.models) {
    const existing = providerMeta.get(model.providerId);
    if (existing) {
      existing.modelCount += 1;
      for (const envVar of model.providerEnvVars ?? []) {
        existing.envVars.add(envVar);
      }
      if (!existing.name && model.providerName) {
        existing.name = model.providerName;
      }
      continue;
    }

    providerMeta.set(model.providerId, {
      name: model.providerName || titleCaseProviderId(model.providerId),
      modelCount: 1,
      authMethods: [{ type: "token", label: "API Token" }],
      envVars: new Set(model.providerEnvVars ?? []),
    });
  }

  const providerIds = Array.from(providerMeta.keys());
  const authMethodsByProvider = listProviderAuthMethods(providerIds);
  const authStates = await Promise.all(
    providerIds.map(
      async providerId => [providerId, await input.authService.getState(providerId)] as const
    )
  );
  const authStateByProvider = new Map(authStates);

  const catalog = providerIds.map(providerId => {
    const meta = providerMeta.get(providerId)!;
    const methods = authMethodsByProvider[providerId] ?? meta.authMethods;
    const connected = authStateByProvider.get(providerId)?.status === "connected";
    return {
      id: providerId,
      name: meta.name,
      aliases: providerAliases(providerId, meta.name),
      authMethods: methods,
      connected,
      modelCount: meta.modelCount,
      popular: POPULAR_PROVIDER_IDS.has(providerId),
      supported: true,
      note: PROVIDER_NOTES[providerId],
    } satisfies ProviderCatalogItem;
  });

  return catalog.sort(sortCatalog);
}
