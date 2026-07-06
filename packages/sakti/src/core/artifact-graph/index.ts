// Types
export {
  ArtifactSchema,
  SchemaYamlSchema,
  type Artifact,
  type SchemaYaml,
  type CompletedSet,
  type BlockedArtifacts,
} from './types.js';

// Schema loading and validation
export { loadSchema, parseSchema, SchemaValidationError } from './schema.js';

// Graph operations
export { ArtifactGraph } from './graph.js';

// State detection
export { detectCompleted } from './state.js';
export { artifactOutputExists, isGlobPattern, resolveArtifactOutputs } from './outputs.js';

// Schema resolution
export {
  resolveSchema,
  listSchemas,
  listSchemasWithInfo,
  getSchemaDir,
  getPackageSchemasDir,
  getUserSchemasDir,
  SchemaLoadError,
  type SchemaInfo,
} from './resolver.js';

// Change status (context loading + formatting)
export {
  loadChangeContext,
  formatChangeStatus,
  type ChangeContext,
  type LoadChangeContextOptions,
  type ChangeStatus,
  type ArtifactStatus,
  type ArtifactPathSummary,
} from './change-status.js';

// Schema diagnostics (resolution + validation)
export {
  validateSchema,
  resolveSchemaLocation,
  checkSchemaLocations,
  type SchemaValidationResult,
  type SchemaResolution,
  type SchemaLocation,
  type ValidationIssue,
  type SchemaSource,
} from './validate.js';
