/**
 * # Catalog entry point
 *
 * Re-exports the generated model catalog produced by
 * `scripts/generate-models.ts` from the models.dev API. The generated data
 * lives in {@link ./generated.ts} (committed; regenerated on demand).
 *
 * ## Exports
 * - {@link CATALOG} — models grouped by provider id (`Record<string, Model[]>`)
 * - {@link ALL_MODELS} — flat list across all providers
 * - {@link PROVIDERS} — sorted provider ids that yielded ≥1 tool-capable model
 *
 * ## Provider count
 *
 * The catalog includes every models.dev provider with at least one
 * tool-capable model — this matches opencode's provider set (the reference
 * implementation we follow). Re-run `nub run generate-models` when models.dev
 * adds providers to pick them up.
 */

export { ALL_MODELS, CATALOG, PROVIDERS } from "./generated.ts";
