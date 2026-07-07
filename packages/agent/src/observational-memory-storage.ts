/**
 * Observational Memory storage contract.
 *
 * Mirrors Mastra's `MemoryStorage` OM methods so the OM processor ports with
 * minimal friction. Vocabulary mapping (see schema glossary):
 *   - `threadId`   = a sakti `sessions.id`
 *   - `resourceId` = a sakti `projects.id`
 *   - `observedMessageIds` = `session_entries.id` of message-kind entries
 *
 * Session-scoped (thread) only in v1. `resourceId` is always present (stored),
 * but lookups are keyed by `thread:{threadId}`.
 *
 * This adapter owns ONLY the `observational_memory` table. To find messages
 * to observe, the processor uses `SessionStorage.getPathToRoot(leafId)` and
 * filters `kind === "message"`.
 */

export type ObservationalMemoryScope = "thread" | "resource";
export type ObservationalMemoryOriginType =
  | "initial"
  | "initialization"
  | "observation"
  | "reflection";

export interface BufferedObservationChunk {
  /** Unique identifier for this chunk (assigned by the adapter on insert) */
  id: string;
  /** Cycle ID for linking to UI buffering markers */
  cycleId: string;
  /** The observation text content */
  observations: string;
  /** Token count of this chunk's observations */
  tokenCount: number;
  /** Message IDs that were observed in this chunk */
  messageIds: string[];
  /** Token count of the messages that were observed (for activation calculation) */
  messageTokens: number;
  /** When the messages were last observed */
  lastObservedAt: Date;
  /** When this chunk was created (assigned by the adapter on insert) */
  createdAt: Date;
  /** Optional suggested continuation from the observer */
  suggestedContinuation?: string;
  /** Optional current task context */
  currentTask?: string;
  /** Optional thread title from observer output */
  threadTitle?: string;
}

/**
 * Input for creating a new buffered observation chunk.
 * The adapter assigns `id` and `createdAt` before persisting.
 */
export interface BufferedObservationChunkInput {
  cycleId: string;
  observations: string;
  tokenCount: number;
  messageIds: string[];
  messageTokens: number;
  lastObservedAt: Date;
  suggestedContinuation?: string;
  currentTask?: string;
  threadTitle?: string;
}

export interface ObservationalMemoryRecord {
  id: string;
  scope: ObservationalMemoryScope;
  threadId: string | null;
  resourceId: string;

  createdAt: Date;
  updatedAt: Date;
  lastObservedAt?: Date;
  lastReflectionAt?: Date;

  originType: ObservationalMemoryOriginType;
  generationCount: number;

  activeObservations: string;
  activeObservationsPendingUpdate?: string;
  bufferedObservationChunks?: BufferedObservationChunk[];
  bufferedReflection?: string;
  bufferedReflectionTokens?: number;
  bufferedReflectionInputTokens?: number;
  reflectedObservationLineCount?: number;
  observedMessageIds?: string[];
  observedTimezone?: string;

  totalTokensObserved: number;
  observationTokenCount: number;
  pendingMessageTokens: number;

  isObserving: boolean;
  isReflecting: boolean;
  isBufferingObservation: boolean;
  isBufferingReflection: boolean;
  lastBufferedAtTokens: number;
  lastBufferedAtTime?: Date | null;

  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ObservationalMemoryHistoryOptions {
  from?: Date;
  to?: Date;
  offset?: number;
}

export interface CreateObservationalMemoryInput {
  threadId: string | null;
  resourceId: string;
  scope: ObservationalMemoryScope;
  config: Record<string, unknown>;
  observedTimezone?: string;
}

export interface UpdateActiveObservationsInput {
  id: string;
  observations: string;
  lastObservedAt: Date;
  tokenCount: number;
  observedMessageIds?: string[];
}

export interface CreateReflectionGenerationInput {
  currentRecord: ObservationalMemoryRecord;
  reflection: string;
  tokenCount: number;
}

export interface SwapBufferedToActiveInput {
  id: string;
  messageTokensThreshold: number;
  activationRatio: number;
  currentPendingTokens: number;
  forceMaxActivation: boolean;
  lastObservedAt?: Date;
}

export interface SwapBufferedToActiveResult {
  chunksActivated: number;
  messageTokensActivated: number;
  observationTokensActivated: number;
  messagesActivated: number;
  activatedCycleIds: string[];
  activatedMessageIds: string[];
}

export interface UpdateBufferedObservationsInput {
  id: string;
  /** The observation chunk to append to the buffer */
  chunk: BufferedObservationChunkInput;
  /** Timestamp cursor for the last buffered message boundary. Set to max message timestamp + 1ms. */
  lastBufferedAtTime?: Date;
}

export interface UpdateBufferedReflectionInput {
  id: string;
  reflection: string;
  /** Token count of the buffered reflection (post-compression output) */
  tokenCount: number;
  /** Observation tokens that were fed into the reflector (pre-compression input) */
  inputTokenCount: number;
  /**
   * The number of lines in activeObservations at the time of reflection.
   * Used at activation time to know which observations were already reflected on.
   */
  reflectedObservationLineCount: number;
}

export interface SwapBufferedReflectionToActiveInput {
  currentRecord: ObservationalMemoryRecord;
  /**
   * Token count for the combined new activeObservations (bufferedReflection + unreflected).
   * Computed by the processor using its token counter before calling the adapter.
   */
  tokenCount: number;
}

export interface UpdateObservationalMemoryConfigInput {
  id: string;
  config: Record<string, unknown>;
}

export interface ObservationalMemoryStorage {
  getObservationalMemory(
    threadId: string | null,
    resourceId: string,
  ): Promise<ObservationalMemoryRecord | null>;
  getObservationalMemoryHistory(
    threadId: string | null,
    resourceId: string,
    limit?: number,
    options?: ObservationalMemoryHistoryOptions,
  ): Promise<ObservationalMemoryRecord[]>;
  initializeObservationalMemory(
    input: CreateObservationalMemoryInput,
  ): Promise<ObservationalMemoryRecord>;
  insertObservationalMemoryRecord(record: ObservationalMemoryRecord): Promise<void>;
  updateActiveObservations(input: UpdateActiveObservationsInput): Promise<void>;
  createReflectionGeneration(
    input: CreateReflectionGenerationInput,
  ): Promise<ObservationalMemoryRecord>;
  setReflectingFlag(id: string, isReflecting: boolean): Promise<void>;
  setObservingFlag(id: string, isObserving: boolean): Promise<void>;
  setBufferingObservationFlag(
    id: string,
    isBuffering: boolean,
    lastBufferedAtTokens?: number,
  ): Promise<void>;
  setBufferingReflectionFlag(id: string, isBuffering: boolean): Promise<void>;
  clearObservationalMemory(threadId: string | null, resourceId: string): Promise<void>;
  setPendingMessageTokens(id: string, tokenCount: number): Promise<void>;
  updateObservationalMemoryConfig(input: UpdateObservationalMemoryConfigInput): Promise<void>;
  updateBufferedObservations(input: UpdateBufferedObservationsInput): Promise<void>;
  swapBufferedToActive(input: SwapBufferedToActiveInput): Promise<SwapBufferedToActiveResult>;
  /** Clear all buffered observation chunks for a record (after thread-scope
   * activation turned them into ObservationEntry tree entries). */
  clearBufferedObservations(id: string): Promise<void>;
  updateBufferedReflection(input: UpdateBufferedReflectionInput): Promise<void>;
  swapBufferedReflectionToActive(
    input: SwapBufferedReflectionToActiveInput,
  ): Promise<ObservationalMemoryRecord>;
  /**
   * Delete all OM generations for the given lookup key except the one with
   * `keepId`. Called after reflection to prune superseded observation
   * generations that are no longer accessible (engine always reads latest).
   */
  pruneHistory(threadId: string | null, resourceId: string, keepId: string): Promise<void>;
}
