#!/usr/bin/env node
/**
 * # Catalog generator
 *
 * Fetches `https://models.dev/api.json` at build time and emits
 * `src/catalog/generated.ts` — a single committed module exporting the
 * converted {@link Model} catalog, keyed by provider id.
 *
 * ## Usage
 *   nub run generate-models     # from packages/llm
 *   node scripts/generate-models.ts
 *
 * ## When to re-run
 * Re-run manually when models.dev adds providers/models sakti-code should
 * surface. The generated file is committed so the app works offline; this
 * script does NOT run at install or runtime.
 *
 * ## Output
 * `src/catalog/generated.ts` exports:
 * - `CATALOG: Record<string, Model[]>` — models grouped by provider id
 * - `ALL_MODELS: Model[]` — flat list across all providers
 * - `PROVIDERS: string[]` — sorted provider ids that yielded ≥1 tool-capable model
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertModelsDevModel } from "../src/catalog/convert.ts";
import type { ModelsDevCatalog, ProviderInfo } from "../src/catalog/types.ts";
import type { Model } from "../src/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");
const outputPath = join(packageRoot, "src", "catalog", "generated.ts");

const MODELS_DEV_URL = "https://models.dev/api.json";

const BUNDLED_NPM = new Set([
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/amazon-bedrock/mantle",
  "@ai-sdk/anthropic",
  "@ai-sdk/azure",
  "@ai-sdk/cerebras",
  "@ai-sdk/cohere",
  "@ai-sdk/deepinfra",
  "@ai-sdk/gateway",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@ai-sdk/google-vertex/anthropic",
  "@ai-sdk/groq",
  "@ai-sdk/mistral",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/togetherai",
  "@ai-sdk/vercel",
  "@ai-sdk/xai",
  "@openrouter/ai-sdk-provider",
  "merge-gateway-ai-sdk-provider",
  "venice-ai-sdk-provider",
  "@aihubmix/ai-sdk-provider",
  "ai-gateway-provider",
  "@jerome-benoit/sap-ai-provider-v2",
  "gitlab-ai-provider",
  "@sakti-code/zai-anthropic",
]);

function checkBundledNpm(catalog: Record<string, Model[]>): void {
  const unbundled = new Set<string>();
  for (const models of Object.values(catalog)) {
    for (const model of models) {
      if (model.npm && !BUNDLED_NPM.has(model.npm)) {
        unbundled.add(model.npm);
      }
    }
  }
  if (unbundled.size > 0) {
    process.stderr.write(
      `WARNING: ${unbundled.size} npm package(s) not bundled: ` +
        [...unbundled].join(", ") +
        "\nThese models will fall to dynamic import at runtime.\n" +
        "Add them to BUNDLED_PROVIDERS in registry.ts and this list.\n",
    );
  }
}

async function main(): Promise<void> {
  process.stderr.write("Fetching models.dev catalog…\n");
  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) {
    throw new Error(`models.dev fetch failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as ModelsDevCatalog;

  const catalog: Record<string, Model[]> = {};
  let totalModels = 0;
  let droppedModels = 0;

  for (const [providerId, provider] of Object.entries(data)) {
    const models = provider.models;
    if (!models) {
      continue;
    }

    const converted: Model[] = [];
    for (const model of Object.values(models)) {
      const result = convertModelsDevModel(provider, model);
      if (result) {
        converted.push(result);
      } else {
        droppedModels++;
      }
    }

    if (converted.length > 0) {
      catalog[providerId] = converted;
      totalModels += converted.length;
    }
  }

  const providers = Object.keys(catalog).sort();
  process.stderr.write(
    `Converted ${totalModels} models across ${providers.length} providers ` +
      `(dropped ${droppedModels} non-tool-capable).\n`,
  );

  const providerInfo: Record<string, ProviderInfo> = {};
  for (const providerId of providers) {
    const rawProvider = data[providerId];
    providerInfo[providerId] = {
      name: rawProvider?.name ?? providerId,
      ...(rawProvider?.doc ? { doc: rawProvider.doc } : {}),
    };
  }

  checkBundledNpm(catalog);

  writeFileSync(outputPath, renderCatalog(catalog, providers, providerInfo));
  process.stderr.write(`Wrote ${outputPath}\n`);
}

/**
 * Render the catalog as a committed TypeScript module.
 *
 * The output imports `Model` from `../types.ts` and `ModelsDevProvider` is
 * NOT needed at runtime — only the converted `Model` values ship. Provider
 * ids are sorted; models within a provider preserve models.dev order.
 */
function renderCatalog(
  catalog: Record<string, Model[]>,
  providers: string[],
  providerInfo: Record<string, ProviderInfo>,
): string {
  const entries = providers
    .map((providerId) => {
      const models = catalog[providerId];
      if (!models) {
        throw new Error(`No models for provider ${providerId}`);
      }
      return `  ${JSON.stringify(providerId)}: [\n${renderModels(models)}\n  ]`;
    })
    .join(",\n");

  const infoEntries = providers
    .map((id) => {
      const info = providerInfo[id];
      if (!info) {
        throw new Error(`No provider info for ${id}`);
      }
      return `  ${JSON.stringify(id)}: {${[
        `"name": ${JSON.stringify(info.name)}`,
        info.doc ? `"doc": ${JSON.stringify(info.doc)}` : null,
      ]
        .filter(Boolean)
        .join(", ")}}`;
    })
    .join(",\n");

  return `\
// GENERATED BY scripts/generate-models.ts — DO NOT EDIT.
// Source: https://models.dev/api.json
// Regenerate: pnpm run generate-models
import type { Model } from "../types.ts";
import type { ProviderInfo } from "./types.ts";

export const CATALOG: Record<string, Model[]> = {
${entries}
};

export const ALL_MODELS: Model[] = Object.values(CATALOG).flat();

export const PROVIDERS: string[] = ${JSON.stringify(providers, null, 0).replace(/,/g, ", ")};

export const PROVIDER_INFO: Record<string, ProviderInfo> = {
${infoEntries}
};
`;
}

function renderModels(models: Model[]): string {
  return models.map((model) => `    ${JSON.stringify(model)},`).join("\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`generate-models failed: ${String(error)}\n`);
  process.exit(1);
});
