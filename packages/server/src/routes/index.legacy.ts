/**
 * Legacy Routes Shim
 *
 * DEPRECATED: These routes are kept for backward compatibility during migration.
 * They are imported by the main index.ts for now but will be removed once
 * all routes are properly migrated to the DDD modules structure.
 *
 * @deprecated Use modules in src/modules/STAR/controller/routes instead
 */

export const LEGACY_ROUTES_WARNING =
  "WARNING: Legacy routes are deprecated and will be removed in a future release. Please use the new DDD module routes from src/modules/*/controller/routes.";

console.warn(LEGACY_ROUTES_WARNING);
