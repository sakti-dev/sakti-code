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
  cycleId?: string;
  observations: string;
  tokenCount: number;
  messageTokens?: number;
  messageIds: string[];
  lastObservedAt?: string; // ISO
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
  chunks: BufferedObservationChunk[];
  mode: "replace" | "append";
  lastBufferedAtTokens?: number;
  lastBufferedAtTime?: Date | null;
}

export interface UpdateBufferedReflectionInput {
  id: string;
  reflection: string;
  reflectionTokens?: number;
  reflectionInputTokens?: number;
  reflectedObservationLineCount?: number;
}

export interface SwapBufferedReflectionToActiveInput {
  id: string;
  currentRecord: ObservationalMemoryRecord;
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
  updateBufferedReflection(input: UpdateBufferedReflectionInput): Promise<void>;
  swapBufferedReflectionToActive(
    input: SwapBufferedReflectionToActiveInput,
  ): Promise<ObservationalMemoryRecord>;
}
