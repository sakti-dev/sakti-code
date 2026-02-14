import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderAdapter } from "../adapters/base";
import { inferModelCapabilities } from "../capabilities";
import type { ModelDescriptor } from "../types";
import type { ModelsDevPayload } from "./models-dev-client";
import { fetchModelsDev } from "./models-dev-client";

interface ModelCatalogServiceOptions {
  adapters: ProviderAdapter[];
  modelsDevSource?: () => Promise<ModelsDevPayload>;
  snapshotSource?: () => Promise<ModelsDevPayload>;
}

interface CatalogModelLike {
  id: string;
  name: string;
}

function buildModelDescriptor(
  providerId: string,
  providerName: string,
  model: CatalogModelLike
): ModelDescriptor {
  return {
    id: `${providerId}/${model.id}`,
    name: model.name,
    providerId,
    providerName,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: inferModelCapabilities({
      providerId,
      modelId: model.id,
      modelName: model.name,
    }),
  };
}

export function normalizeProviderAlias(input: string): string {
  const normalized = input.trim().toLowerCase();

  if (["z.ai", "z-ai", "zen", "z.ai coding plan", "zai"].includes(normalized)) {
    return "zai";
  }

  if (normalized === "kimi") {
    return "moonshot";
  }

  return normalized;
}

export function createModelCatalogService(options: ModelCatalogServiceOptions) {
  const modelsDevSource = options.modelsDevSource ?? fetchModelsDev;
  const snapshotSource =
    options.snapshotSource ??
    (async () => {
      const baseDir = dirname(fileURLToPath(import.meta.url));
      const snapshotPath = join(baseDir, "snapshot.json");
      const raw = await readFile(snapshotPath, "utf-8");
      return JSON.parse(raw) as ModelsDevPayload;
    });

  return {
    async list(): Promise<ModelDescriptor[]> {
      const finalMap = new Map<string, ModelDescriptor>();

      const snapshotData = await snapshotSource().catch(() => ({}) as ModelsDevPayload);
      const modelsDevData = await modelsDevSource().catch(() => ({}) as ModelsDevPayload);

      for (const [providerKey, provider] of Object.entries(snapshotData)) {
        const providerId = normalizeProviderAlias(providerKey);
        for (const model of Object.values(provider.models ?? {})) {
          const descriptor = buildModelDescriptor(providerId, provider.name ?? providerId, model);
          finalMap.set(descriptor.id, descriptor);
        }
      }

      for (const [providerKey, provider] of Object.entries(modelsDevData)) {
        const providerId = normalizeProviderAlias(providerKey);
        for (const model of Object.values(provider.models ?? {})) {
          const descriptor = buildModelDescriptor(providerId, provider.name ?? providerId, model);
          finalMap.set(descriptor.id, descriptor);
        }
      }

      for (const adapter of options.adapters) {
        const adapterModels = await adapter.listModels();
        for (const model of adapterModels) {
          const normalizedId = model.id.includes("/") ? model.id : `${adapter.id}/${model.id}`;
          finalMap.set(normalizedId, {
            ...model,
            id: normalizedId,
            providerId: model.providerId || adapter.id,
          });
        }
      }

      return Array.from(finalMap.values()).sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}
