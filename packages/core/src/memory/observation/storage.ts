/**
 * ObservationalMemoryStorage - Async Buffering & Crash Recovery
 *
 * Phase 2 Memory System implementation.
 * Provides observation memory with:
 * - State flags for tracking observation/reflection progress
 * - Lease-based locking for multi-instance safety
 * - Async buffering for non-blocking observation
 * - Stale flag detection for crash recovery
 */

import { getDb, observationalMemory, type ObservationalMemory } from "@ekacode/server/db";
import { and, eq } from "drizzle-orm";

export interface ObservationalMemoryConfig {
  observationThreshold: number;
  reflectionThreshold: number;
  bufferTokens: number;
  bufferActivation: number;
  blockAfter: number;
  scope: "thread" | "resource";
  lastMessages: number;
}

export interface BufferedObservationChunk {
  content: string;
  messageIds: string[];
  messageTokens: number;
  createdAt: Date;
}

/**
 * Message interface for observation processing
 */
export interface ObservationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: number;
}

/**
 * Observer agent function type
 * Called to generate observations from messages
 */
export type ObserverAgent = (
  activeObservations: string,
  messages: ObservationMessage[]
) => Promise<string>;

/**
 * Token counter interface for calculating message token counts
 */
export interface TokenCounter {
  countMessages(messages: ObservationMessage[]): number;
  countString(str: string): number;
}

/**
 * Simple token counter implementation using approximate word count
 * In production, this should use tiktoken or similar
 */
export class SimpleTokenCounter implements TokenCounter {
  countMessages(messages: ObservationMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.countString(msg.content);
      total += this.countString(msg.role);
    }
    return total;
  }

  countString(str: string): number {
    // Approximate: 1 token ≈ 4 characters for English text
    // This is a rough approximation - production should use tiktoken
    return Math.ceil(str.length / 4);
  }
}

/**
 * Threshold calculation result
 */
export interface ThresholdResult {
  totalPendingTokens: number;
  threshold: number;
}

/**
 * Calculate observation thresholds
 *
 * @param allMessages - All messages in the conversation
 * @param unobservedMessages - Messages not yet observed
 * @param pendingTokens - Pending tokens from storage
 * @param otherThreadTokens - Tokens from other threads (resource scope)
 * @param currentObservationTokens - Tokens in current observations
 * @param record - Observational memory record
 * @returns Threshold calculation result
 */
export function calculateObservationThresholds(
  allMessages: ObservationMessage[],
  unobservedMessages: ObservationMessage[],
  pendingTokens: number,
  otherThreadTokens: number,
  currentObservationTokens: number,
  record: ObservationalMemory,
  tokenCounter: TokenCounter
): ThresholdResult {
  const allMessageTokens = tokenCounter.countMessages(allMessages);

  // Total = all messages + other threads + pending from storage + current observations
  const totalPendingTokens =
    allMessageTokens + otherThreadTokens + pendingTokens + currentObservationTokens;

  // Threshold = observationThreshold - current observations (leaves room for new content)
  const config = record.config ?? DEFAULT_CONFIG;
  const threshold = (config.observationThreshold ?? 30000) - currentObservationTokens;

  return { totalPendingTokens, threshold };
}

export interface CreateObservationalMemoryInput {
  threadId?: string;
  resourceId?: string;
  scope: "thread" | "resource";
  createdAt: number;
  config?: Partial<ObservationalMemoryConfig>;
}

export interface UpdateObservationalMemoryInput {
  activeObservations?: string;
  bufferedObservationChunks?: BufferedObservationChunk[];
  isObserving?: boolean;
  isReflecting?: boolean;
  isBufferingObservation?: boolean;
  isBufferingReflection?: boolean;
  lastObservedAt?: number;
  observedMessageIds?: string[];
  generationCount?: number;
}

const DEFAULT_CONFIG: ObservationalMemoryConfig = {
  observationThreshold: 30000,
  reflectionThreshold: 40000,
  bufferTokens: 6000,
  bufferActivation: 0.8,
  blockAfter: 7200,
  scope: "thread",
  lastMessages: 10,
};

export class ObservationalMemoryStorage {
  static asyncBufferingOps: Map<string, Promise<void>> = new Map();

  private getLookupKey(
    scope: "thread" | "resource",
    resourceId?: string,
    threadId?: string
  ): string {
    if (scope === "resource" && resourceId) {
      return `resource:${resourceId}`;
    }
    if (scope === "thread" && threadId) {
      return `thread:${threadId}`;
    }
    throw new Error(
      "Invalid scope: must provide resourceId for resource scope or threadId for thread scope"
    );
  }

  async createObservationalMemory(
    input: CreateObservationalMemoryInput
  ): Promise<ObservationalMemory> {
    const db = await getDb();
    const now = new Date(input.createdAt);
    const lookupKey = this.getLookupKey(input.scope, input.resourceId, input.threadId);
    const config: ObservationalMemoryConfig = {
      ...DEFAULT_CONFIG,
      ...input.config,
      scope: input.scope,
    };

    const [record] = await db
      .insert(observationalMemory)
      .values({
        id: crypto.randomUUID(),
        thread_id: input.threadId ?? null,
        resource_id: input.resourceId ?? null,
        scope: input.scope,
        lookup_key: lookupKey,
        config,
        is_observing: 0,
        is_reflecting: 0,
        is_buffering_observation: 0,
        is_buffering_reflection: 0,
        generation_count: 0,
        created_at: now,
        updated_at: now,
      })
      .returning();

    return record;
  }

  async getObservationalMemory(
    scope: "thread" | "resource",
    resourceId?: string,
    threadId?: string
  ): Promise<ObservationalMemory | null> {
    const db = await getDb();
    const lookupKey = this.getLookupKey(scope, resourceId, threadId);

    const result = await db
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.lookup_key, lookupKey))
      .get();

    return result ?? null;
  }

  async getObservationalMemoryById(id: string): Promise<ObservationalMemory | null> {
    const db = await getDb();
    const result = await db
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.id, id))
      .get();
    return result ?? null;
  }

  async updateObservationalMemory(
    id: string,
    input: UpdateObservationalMemoryInput
  ): Promise<ObservationalMemory | null> {
    const db = await getDb();
    const updateData: Partial<ObservationalMemory> = {};

    if (input.activeObservations !== undefined) {
      updateData.active_observations = input.activeObservations;
    }
    if (input.bufferedObservationChunks !== undefined) {
      updateData.buffered_observation_chunks = input.bufferedObservationChunks;
    }
    if (input.isObserving !== undefined) {
      updateData.is_observing = input.isObserving ? 1 : 0;
    }
    if (input.isReflecting !== undefined) {
      updateData.is_reflecting = input.isReflecting ? 1 : 0;
    }
    if (input.isBufferingObservation !== undefined) {
      updateData.is_buffering_observation = input.isBufferingObservation ? 1 : 0;
    }
    if (input.isBufferingReflection !== undefined) {
      updateData.is_buffering_reflection = input.isBufferingReflection ? 1 : 0;
    }
    if (input.lastObservedAt !== undefined) {
      updateData.last_observed_at = new Date(input.lastObservedAt);
    }
    if (input.observedMessageIds !== undefined) {
      updateData.observed_message_ids = input.observedMessageIds;
    }
    if (input.generationCount !== undefined) {
      updateData.generation_count = input.generationCount;
    }

    if (Object.keys(updateData).length === 0) {
      return this.getObservationalMemoryById(id);
    }

    updateData.updated_at = new Date();

    const [updated] = await db
      .update(observationalMemory)
      .set(updateData)
      .where(eq(observationalMemory.id, id))
      .returning();

    return updated ?? null;
  }

  async acquireLock(
    id: string,
    ownerId: string,
    leaseMs: number = 30000
  ): Promise<{ success: boolean; operationId?: string }> {
    const db = await getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + leaseMs);

    const existing = await db
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.id, id))
      .get();

    if (!existing) {
      return { success: false };
    }

    const isExpired = !existing.lock_expires_at || existing.lock_expires_at < now;
    const isSameOwner = existing.lock_owner_id === ownerId;

    if (!isExpired && !isSameOwner) {
      return { success: false };
    }

    let operationId = existing.lock_operation_id;
    if (!operationId || isExpired) {
      operationId = crypto.randomUUID();
    }

    await db
      .update(observationalMemory)
      .set({
        lock_owner_id: ownerId,
        lock_expires_at: expiresAt,
        lock_operation_id: operationId,
        last_heartbeat_at: now,
        updated_at: now,
      })
      .where(eq(observationalMemory.id, id));

    return { success: true, operationId };
  }

  async heartbeatLock(id: string, ownerId: string, operationId: string): Promise<boolean> {
    const db = await getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30000);

    const [updated] = await db
      .update(observationalMemory)
      .set({
        last_heartbeat_at: now,
        lock_expires_at: expiresAt,
        updated_at: now,
      })
      .where(
        and(
          eq(observationalMemory.id, id),
          eq(observationalMemory.lock_owner_id, ownerId),
          eq(observationalMemory.lock_operation_id, operationId)
        )
      )
      .returning({ id: observationalMemory.id });

    return !!updated;
  }

  async releaseLock(id: string, ownerId: string, operationId: string): Promise<boolean> {
    const db = await getDb();
    const now = new Date();

    const [updated] = await db
      .update(observationalMemory)
      .set({
        lock_owner_id: null,
        lock_expires_at: null,
        lock_operation_id: null,
        last_heartbeat_at: null,
        updated_at: now,
      })
      .where(
        and(
          eq(observationalMemory.id, id),
          eq(observationalMemory.lock_owner_id, ownerId),
          eq(observationalMemory.lock_operation_id, operationId)
        )
      )
      .returning({ id: observationalMemory.id });

    return !!updated;
  }

  async setBufferingObservationFlag(
    id: string,
    isBuffering: boolean,
    currentTokens: number
  ): Promise<void> {
    const db = await getDb();
    const now = new Date();

    await db
      .update(observationalMemory)
      .set({
        is_buffering_observation: isBuffering ? 1 : 0,
        last_buffered_at_tokens: currentTokens,
        last_buffered_at_time: isBuffering ? now : null,
        updated_at: now,
      })
      .where(eq(observationalMemory.id, id));
  }

  async updateBufferedObservations(id: string, chunks: BufferedObservationChunk[]): Promise<void> {
    const db = await getDb();
    const now = new Date();

    await db
      .update(observationalMemory)
      .set({
        buffered_observation_chunks: chunks,
        updated_at: now,
      })
      .where(eq(observationalMemory.id, id));
  }

  async swapBufferedToActive(id: string, _activationRatio: number): Promise<void> {
    const db = await getDb();
    const record = await this.getObservationalMemoryById(id);

    if (
      !record ||
      !record.buffered_observation_chunks ||
      record.buffered_observation_chunks.length === 0
    ) {
      return;
    }

    const bufferedContent = record.buffered_observation_chunks.map(c => c.content).join("\n\n");
    const activeContent = record.active_observations ?? "";

    const newActiveContent = activeContent
      ? activeContent + "\n\n" + bufferedContent
      : bufferedContent;

    await db
      .update(observationalMemory)
      .set({
        active_observations: newActiveContent,
        buffered_observation_chunks: [],
        is_buffering_observation: 0,
        updated_at: new Date(),
      })
      .where(eq(observationalMemory.id, id));
  }

  async detectAndClearStaleFlags(id: string): Promise<void> {
    const record = await this.getObservationalMemoryById(id);

    if (!record) {
      return;
    }

    const now = new Date();
    const db = await getDb();

    if (record.is_buffering_observation && !ObservationalMemoryStorage.asyncBufferingOps.has(id)) {
      await db
        .update(observationalMemory)
        .set({
          is_buffering_observation: 0,
          last_buffered_at_time: null,
          updated_at: now,
        })
        .where(eq(observationalMemory.id, id));
    }

    if (record.is_buffering_reflection && !ObservationalMemoryStorage.asyncBufferingOps.has(id)) {
      await db
        .update(observationalMemory)
        .set({
          is_buffering_reflection: 0,
          updated_at: now,
        })
        .where(eq(observationalMemory.id, id));
    }

    if (record.lock_expires_at && record.lock_expires_at < now) {
      const isActive = ObservationalMemoryStorage.asyncBufferingOps.has(id);
      if (!isActive) {
        await db
          .update(observationalMemory)
          .set({
            lock_owner_id: null,
            lock_expires_at: null,
            lock_operation_id: null,
            last_heartbeat_at: null,
            updated_at: now,
          })
          .where(eq(observationalMemory.id, id));
      }
    }
  }

  /**
   * Start async buffered observation
   * Non-blocking observation that runs in the background
   *
   * @param record - Observational memory record
   * @param messages - Unobserved messages to process
   * @param observerAgent - Agent function to generate observations
   * @param tokenCounter - Token counter for calculating message sizes
   * @param currentPendingTokens - Current token count
   * @param lockKey - Key for async operation tracking
   */
  async startAsyncBufferedObservation(
    record: ObservationalMemory,
    messages: ObservationMessage[],
    observerAgent: ObserverAgent,
    tokenCounter: TokenCounter,
    currentPendingTokens: number,
    lockKey: string
  ): Promise<void> {
    // Set flag in DB
    await this.setBufferingObservationFlag(record.id, true, currentPendingTokens);

    // Start background task
    const observationPromise = (async () => {
      try {
        // Generate observations
        const observations = await observerAgent(record.active_observations ?? "", messages);

        // Create chunk
        const chunk: BufferedObservationChunk = {
          content: observations,
          messageIds: messages.map(m => m.id),
          messageTokens: tokenCounter.countMessages(messages),
          createdAt: new Date(),
        };

        // Get existing chunks and append
        const existingChunks = record.buffered_observation_chunks ?? [];
        const updatedChunks = [...existingChunks, chunk];

        // Store in buffer
        await this.updateBufferedObservations(record.id, updatedChunks);
      } catch (error) {
        // Clear flag on error
        await this.setBufferingObservationFlag(record.id, false, currentPendingTokens);
        throw error;
      }
    })();

    // Register in static map for cross-instance tracking
    ObservationalMemoryStorage.asyncBufferingOps.set(lockKey, observationPromise);

    // Clean up when done
    observationPromise
      .then(() => {
        ObservationalMemoryStorage.asyncBufferingOps.delete(lockKey);
      })
      .catch(() => {
        ObservationalMemoryStorage.asyncBufferingOps.delete(lockKey);
      });
  }

  /**
   * Try to activate buffered observations
   * Moves buffered observations to active when threshold is reached
   *
   * @param record - Observational memory record
   * @param currentPendingTokens - Current token count
   * @returns true if activation occurred, false otherwise
   */
  async tryActivateBufferedObservations(
    record: ObservationalMemory,
    currentPendingTokens: number
  ): Promise<boolean> {
    const bufferedChunks = record.buffered_observation_chunks ?? [];
    if (bufferedChunks.length === 0) {
      return false;
    }

    const config = record.config ?? DEFAULT_CONFIG;
    const threshold = config.observationThreshold ?? 30000;
    const activationThreshold = threshold * (config.bufferActivation ?? 0.8);

    if (currentPendingTokens < activationThreshold) {
      return false; // Not enough tokens, keep buffering
    }

    // Swap buffered → active
    await this.swapBufferedToActive(record.id, 1.0);

    return true;
  }
}

export const observationalMemoryStorage = new ObservationalMemoryStorage();
