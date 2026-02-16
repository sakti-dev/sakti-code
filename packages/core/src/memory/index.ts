/**
 * Memory System Index
 *
 * Phase 1: Task Memory + Message Memory with FTS5 search
 * Phase 2: Observational Memory with async buffering & crash recovery
 * Phase 3: Reflector & Multi-Level Compaction with 4-level context stack
 * Phase 4: Working Memory + Memory Processors Architecture
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
  buildObserverPromptForMode,
  createObserverAgent,
  createObserverAgentFromConfig,
  filterAlreadyObservedMessages,
  formatContextStack,
  formatObservationsForInjection,
  getAgentMode,
  getContextStack,
  getObservationsForContext,
  getOrCreateObservationalMemory,
  hasBufferedObservations,
  isAsyncObservationEnabled,
  processInputStep,
  shouldReflect,
  shouldTriggerAsyncObservation,
  triggerReflection,
  type ContextLevel,
  type ProcessInputStepArgs,
  type ThreadContext,
} from "./observation/orchestration";

export {
  reflectionStorage,
  type CreateReflectionInput,
  type ReflectionType,
} from "./reflection/storage";

export {
  COMPRESSION_GUIDANCE,
  callReflectorAgent,
  type ReflectorInput,
  type ReflectorOutput,
} from "./reflection/reflector";

// Phase 4: Working Memory
export {
  WORKING_MEMORY_TEMPLATE,
  parseWorkingMemoryContent,
  workingMemoryStorage,
  type CreateWorkingMemoryInput,
  type UpdateWorkingMemoryInput,
  type WorkingMemoryData,
  type WorkingMemoryScope,
} from "./working-memory";

// Phase 4: Memory Processors
export {
  MemoryProcessor,
  memoryProcessor,
  type MemoryProcessorInputArgs,
  type MemoryProcessorInputResult,
  type MemoryProcessorOutputArgs,
  type MemoryProcessorOutputResult,
  type SemanticRecallConfig,
} from "./processors";
