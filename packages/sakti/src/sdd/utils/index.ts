// SDD utilities — exported so the server runtime can consume sakti as a library
// (progress-aware reminders, change-metadata lookups) rather than only via CLI.

export {
  countTasksFromContent,
  formatTaskStatus,
  getTaskProgressForChange,
  type TaskProgress,
} from "./task-progress.js";

export {
  METADATA_FILENAME,
  ChangeMetadataError,
  readChangeMetadata,
  resolveSchemaForChange,
  validateSchemaName,
  writeChangeMetadata,
  type ResolveSchemaForChangeOptions,
} from "./change-metadata.js";

export { type ChangeMetadata, type ChangeMetadataInput } from "../core/change-metadata/index.js";
