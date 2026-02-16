/**
 * Memory System Index
 *
 * Phase 1 Memory System exports.
 * Phase 2: Observational Memory with async buffering & crash recovery.
 */

export {
  taskStorage,
  type BlockedStatus,
  type CreateTaskInput,
  type ListTasksOptions,
  type UpdateTaskInput,
} from "./task/storage";
export { executeTaskMutate, taskMutateTool } from "./task/task-mutate";
export { executeTaskQuery, taskQueryTool } from "./task/task-query";

export {
  messageStorage,
  type CreateMessageInput,
  type ListMessagesOptions,
} from "./message/storage";

export { executeMemorySearch, memorySearchTool, type SearchResult } from "./search";

export {
  SimpleTokenCounter,
  calculateObservationThresholds,
  observationalMemoryStorage,
  type BufferedObservationChunk,
  type CreateObservationalMemoryInput,
  type ObservationMessage,
  type ObservationalMemoryConfig,
  type ObserverAgent,
  type ThresholdResult,
  type TokenCounter,
  type UpdateObservationalMemoryInput,
} from "./observation/storage";

export {
  ObservationMarkers,
  findLastCompletedObservationBoundary,
  getMessageSealedAt,
  getUnobservedParts,
  insertObservationMarker,
  isMessageSealed,
  isObservationMarker,
  sealMessage,
  type MessagePart,
  type SealedMessage,
} from "./observation/sealing";

export {
  filterAlreadyObservedMessages,
  getObservationsForContext,
  getOrCreateObservationalMemory,
  hasBufferedObservations,
  isAsyncObservationEnabled,
  processInputStep,
  shouldTriggerAsyncObservation,
  type ProcessInputStepArgs,
  type ThreadContext,
} from "./observation/orchestration";

export {
  reflectionStorage,
  type CreateReflectionInput,
  type ReflectionType,
} from "./reflection/storage";
