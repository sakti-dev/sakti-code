import type { Options } from "tsup";

/**
 * Shared tsup options for workspace packages. Each package has a thin
 * `tsup.config.ts` that imports this and adds its `entry` list.
 *
 * - ESM only (packages are `"type": "module"`).
 * - `dts: true` emits declarations alongside the JS.
 * - Dependencies are externalized automatically (tsup reads `package.json`
 *   `dependencies`), so `@sakti-code/*`, `pino`, etc. resolve from
 *   `node_modules` at runtime — they are never inlined into the bundle.
 *
 * NOTE: tsup rewrites `node:sqlite` → bare `sqlite` in its output (bare
 * `fs`/`path` still resolve, but `sqlite` is only valid as `node:sqlite`).
 * Each package's `build` script runs `scripts/restore-node-protocol.mjs`
 * after `tsup` to restore the `node:` prefix (tsup's `onSuccess`/esbuild
 * plugin hooks are not invoked by this tsup version).
 */
export const sharedConfig: Options = {
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Externalize every bare specifier (packages + node: builtins) so only the
  // package's own source is bundled. tsup auto-externalizes declared
  // `dependencies`, but packages also import root-level deps (e.g. agent
  // imports `yaml`/`uuid`, server imports `typebox`) that aren't in their own
  // deps — without this, CJS deps like `yaml` get bundled into ESM output and
  // crash at runtime ("Dynamic require of 'process' is not supported").
  external: [/^[^.]/],
};
