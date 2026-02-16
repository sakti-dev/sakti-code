/**
 * Observational Memory Orchestration Layer
 *
 * High-level orchestration for the observation flow:
 * - Token threshold calculation
 * - Async observation triggering
 * - Buffered observation activation
 * - Context injection into messages
 * - Reflection triggering (Phase 3)
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";

import type { ObservationalMemory } from "@ekacode/server/db";
import {
  calculateObservationThresholds,
  observationalMemoryStorage,
  type ObservationalMemoryConfig,
  type ObservationMessage,
  type TokenCounter,
} from "./storage";

import { callReflectorAgent, type ReflectorInput } from "../reflection/reflector";
import { reflectionStorage } from "../reflection/storage";

/**
 * Thread context information
 */
export interface ThreadContext {
  threadId: string;
  resourceId?: string;
  scope: "thread" | "resource";
}

/**
 * Process input step arguments
 */
export interface ProcessInputStepArgs {
  messages: ObservationMessage[];
  context: ThreadContext;
  stepNumber: number;
  readOnly?: boolean;
  tokenCounter: TokenCounter;
  observerAgent: (activeObservations: string, messages: ObservationMessage[]) => Promise<string>;
  reflectorModel?: LanguageModelV3;
}

/**
 * Get or create observational memory record for a thread/resource
 *
 * @param context - Thread context
 * @returns Observational memory record
 */
export async function getOrCreateObservationalMemory(
  context: ThreadContext
): Promise<ObservationalMemory> {
  const { threadId, resourceId, scope } = context;

  // Try to get existing record
  let record = await observationalMemoryStorage.getObservationalMemory(scope, resourceId, threadId);

  if (record) {
    return record;
  }

  // Create new record
  record = await observationalMemoryStorage.createObservationalMemory({
    threadId,
    resourceId,
    scope,
    createdAt: Date.now(),
  });

  return record;
}

/**
 * Check if async observation is enabled
 * Currently always enabled - can be configured via feature flags
 *
 * @returns true if async observation is enabled
 */
export function isAsyncObservationEnabled(): boolean {
  // Can be controlled via environment variable or config
  return process.env.DISABLE_ASYNC_OBSERVATION !== "true";
}

/**
 * Determine if async observation should be triggered
 *
 * @param totalPendingTokens - Total pending tokens
 * @param threshold - Observation threshold
 * @param bufferTokens - Buffer token interval
 * @param lastBufferedAtTokens - Last buffer trigger token count
 * @returns true if async observation should trigger
 */
export function shouldTriggerAsyncObservation(
  totalPendingTokens: number,
  threshold: number,
  bufferTokens: number,
  lastBufferedAtTokens?: number | null
): boolean {
  // Don't trigger if we've reached the threshold (sync will handle it)
  if (totalPendingTokens >= threshold) {
    return false;
  }

  // Trigger at bufferTokens intervals
  const tokensSinceLastBuffer = lastBufferedAtTokens
    ? totalPendingTokens - lastBufferedAtTokens
    : totalPendingTokens;

  return tokensSinceLastBuffer >= bufferTokens;
}

/**
 * Load other threads' context for resource scope
 * Returns unobserved context blocks from other threads
 *
 * @param resourceId - Resource ID
 * @param currentThreadId - Current thread ID to exclude
 * @returns Context blocks or undefined if none
 */
export async function loadOtherThreadsContext(
  _resourceId: string,
  _currentThreadId: string
): Promise<string | undefined> {
  // TODO: Implement when resource scope is fully supported
  // This would query other threads' observations and format them
  return undefined;
}

/**
 * Filter out already observed messages
 *
 * @param messages - Messages to filter
 * @param record - Observational memory record
 * @returns Filtered messages
 */
export function filterAlreadyObservedMessages(
  messages: ObservationMessage[],
  record: ObservationalMemory
): ObservationMessage[] {
  const observedIds = new Set(record.observed_message_ids ?? []);

  return messages.filter(msg => !observedIds.has(msg.id));
}

/**
 * Handle threshold reached - trigger synchronous observation
 *
 * @param messages - Messages to observe
 * @param record - Observational memory record
 * @param observerAgent - Agent to generate observations
 * @param tokenCounter - Token counter
 */
async function handleThresholdReached(
  messages: ObservationMessage[],
  record: ObservationalMemory,
  observerAgent: (activeObservations: string, messages: ObservationMessage[]) => Promise<string>,
  tokenCounter: TokenCounter
): Promise<void> {
  // Acquire lock for observation
  const ownerId = process.env.INSTANCE_ID || "default-instance";
  const lockResult = await observationalMemoryStorage.acquireLock(record.id, ownerId);

  if (!lockResult.success) {
    // Another instance is observing, skip
    return;
  }

  try {
    // Set observing flag
    await observationalMemoryStorage.updateObservationalMemory(record.id, {
      isObserving: true,
    });

    // Generate observations
    const observations = await observerAgent(record.active_observations ?? "", messages);

    // Create observation chunk
    const chunk = {
      content: observations,
      messageIds: messages.map(m => m.id),
      messageTokens: tokenCounter.countMessages(messages),
      createdAt: new Date(),
    };

    // Update record with new observations
    const observedIds = [...(record.observed_message_ids ?? []), ...messages.map(m => m.id)];

    await observationalMemoryStorage.updateObservationalMemory(record.id, {
      activeObservations: record.active_observations
        ? `${record.active_observations}\n\n${chunk.content}`
        : chunk.content,
      observedMessageIds: observedIds,
      isObserving: false,
      lastObservedAt: Date.now(),
    });
  } catch (error) {
    // Clear flag on error
    await observationalMemoryStorage.updateObservationalMemory(record.id, {
      isObserving: false,
    });
    throw error;
  } finally {
    // Release lock
    if (lockResult.operationId) {
      await observationalMemoryStorage.releaseLock(record.id, ownerId, lockResult.operationId);
    }
  }
}

/**
 * Main process input step
 * Orchestrates the entire observation flow
 *
 * @param args - Process arguments
 * @returns Processed messages with observations
 */
export async function processInputStep(args: ProcessInputStepArgs): Promise<{
  messages: ObservationMessage[];
  record: ObservationalMemory;
  observationsInjected: boolean;
  didObserve: boolean;
}> {
  const {
    messages,
    context,
    stepNumber,
    readOnly = false,
    tokenCounter,
    observerAgent,
    reflectorModel,
  } = args;
  const { threadId, resourceId, scope } = context;

  // 1. Get or create record
  let record = await getOrCreateObservationalMemory(context);

  // 2. Detect and clear stale flags (crash recovery)
  await observationalMemoryStorage.detectAndClearStaleFlags(record.id);

  // Refresh record after stale flag cleanup
  const refreshedRecord = await observationalMemoryStorage.getObservationalMemory(
    scope,
    resourceId,
    threadId
  );
  if (!refreshedRecord) {
    throw new Error("Failed to get observational memory record");
  }
  record = refreshedRecord;

  // 3. Load other threads' context (resource scope only)
  let otherThreadTokens = 0;
  if (scope === "resource" && resourceId) {
    const contextBlocks = await loadOtherThreadsContext(resourceId, threadId);
    if (contextBlocks) {
      otherThreadTokens = tokenCounter.countString(contextBlocks);
    }
  }

  // 4. Try to activate buffered observations (step 0 only)
  if (stepNumber === 0 && isAsyncObservationEnabled()) {
    const activated = await observationalMemoryStorage.tryActivateBufferedObservations(
      record,
      0 // Will calculate fresh
    );

    if (activated) {
      // Refresh record after activation
      const activatedRecord = await observationalMemoryStorage.getObservationalMemory(
        scope,
        resourceId,
        threadId
      );
      if (!activatedRecord) {
        throw new Error("Failed to get observational memory record after activation");
      }
      record = activatedRecord;
    }
  }

  // 5. Calculate thresholds
  let didObserve = false;
  if (!readOnly) {
    const unobservedMessages = filterAlreadyObservedMessages(messages, record);

    const currentObservationTokens = record.active_observations
      ? tokenCounter.countString(record.active_observations)
      : 0;

    const pendingTokens = record.last_buffered_at_tokens ?? 0;

    const { totalPendingTokens, threshold } = calculateObservationThresholds(
      messages,
      unobservedMessages,
      pendingTokens,
      otherThreadTokens,
      currentObservationTokens,
      record,
      tokenCounter
    );

    // 6. Async buffering: trigger at bufferTokens intervals
    if (
      isAsyncObservationEnabled() &&
      totalPendingTokens < threshold &&
      unobservedMessages.length > 0
    ) {
      const config = record.config ?? {
        observationThreshold: 30000,
        bufferTokens: 6000,
      };

      if (
        shouldTriggerAsyncObservation(
          totalPendingTokens,
          threshold,
          config.bufferTokens ?? 6000,
          record.last_buffered_at_tokens
        )
      ) {
        const lockKey = `async-observation-${record.id}`;
        await observationalMemoryStorage.startAsyncBufferedObservation(
          record,
          unobservedMessages,
          observerAgent,
          tokenCounter,
          totalPendingTokens,
          lockKey
        );
      }
    }

    // 7. Threshold reached: observe synchronously
    if (stepNumber > 0 && totalPendingTokens >= threshold && unobservedMessages.length > 0) {
      await handleThresholdReached(unobservedMessages, record, observerAgent, tokenCounter);
      didObserve = true;

      // Refresh record after observation
      const observedRecord = await observationalMemoryStorage.getObservationalMemory(
        scope,
        resourceId,
        threadId
      );
      if (!observedRecord) {
        throw new Error("Failed to get observational memory record after observation");
      }
      record = observedRecord;
    }
  }

  // 7b. Check for reflection (Phase 3)
  if (!readOnly && reflectorModel) {
    const currentObservationTokens = record.active_observations
      ? tokenCounter.countString(record.active_observations)
      : 0;

    if (shouldReflect(currentObservationTokens, record)) {
      record = await triggerReflection(record, reflectorModel);
    }
  }

  // 8. Filter already observed messages for return
  const filteredMessages = filterAlreadyObservedMessages(messages, record);

  return {
    messages: filteredMessages,
    record,
    observationsInjected: !!record.active_observations,
    didObserve,
  };
}

/**
 * Check if there are pending buffered observations
 *
 * @param record - Observational memory record
 * @returns true if there are buffered observations
 */
export function hasBufferedObservations(record: ObservationalMemory): boolean {
  return (record.buffered_observation_chunks?.length ?? 0) > 0;
}

/**
 * Context injection levels for Phase 3
 *
 * Level 1: Reflections (most condensed, from reflector agent)
 * Level 2: Recent observations raw (within sliding window)
 * Level 3: Recent messages (full detail)
 * Level 4: On-demand (via BM25 search - handled by memory-search tool)
 */
export interface ContextLevel {
  level: number;
  name: string;
  content: string;
  tokenCount: number;
}

/**
 * Get observations formatted for LLM context injection
 * Simple version - returns active observations as-is
 *
 * @param record - Observational memory record
 * @returns Formatted observations string
 */
export function getObservationsForContext(record: ObservationalMemory): string {
  if (!record.active_observations) {
    return "";
  }

  return record.active_observations;
}

/**
 * Get full 4-level context stack for LLM
 *
 * @param record - Observational memory record
 * @param recentMessages - Recent messages to include
 * @param tokenCounter - Token counter
 * @returns Array of context levels
 */
export async function getContextStack(
  record: ObservationalMemory,
  recentMessages: ObservationMessage[],
  tokenCounter: TokenCounter
): Promise<ContextLevel[]> {
  const levels: ContextLevel[] = [];

  // Level 1: Reflections (most condensed)
  const reflections = await reflectionStorage.getReflectionsByThread(record.thread_id ?? "", 5);

  if (reflections.length > 0) {
    const reflectionContent = reflections.map(r => r.content).join("\n\n---\n\n");
    levels.push({
      level: 1,
      name: "Reflections",
      content: reflectionContent,
      tokenCount: tokenCounter.countString(reflectionContent),
    });
  }

  // Level 2: Recent observations raw (sliding window)
  const activeObs = record.active_observations;
  if (activeObs) {
    const config = (record.config ?? {}) as ObservationalMemoryConfig;
    const maxRecentObs = config.maxRecentObservations ?? 50;

    // Keep recent observations raw - extract last N observations
    const observationLines = activeObs.split("\n").filter(l => l.trim());
    const recentObservations = observationLines.slice(-maxRecentObs).join("\n");

    levels.push({
      level: 2,
      name: "Recent Observations",
      content: recentObservations,
      tokenCount: tokenCounter.countString(recentObservations),
    });
  }

  // Level 3: Recent messages (full detail)
  const config = (record.config ?? {}) as ObservationalMemoryConfig;
  const lastMessages = config.lastMessages ?? 10;
  const recentMsgs = recentMessages.slice(-lastMessages);

  if (recentMsgs.length > 0) {
    const messagesContent = recentMsgs.map(m => `${m.role}: ${m.content}`).join("\n");

    levels.push({
      level: 3,
      name: "Recent Messages",
      content: messagesContent,
      tokenCount: tokenCounter.countString(messagesContent),
    });
  }

  // Level 4: On-demand via BM25 search (not included here - handled by memory-search tool)

  return levels;
}

/**
 * Format context stack for injection
 *
 * @param levels - Context levels
 * @returns Formatted string for LLM context
 */
export function formatContextStack(levels: ContextLevel[]): string {
  if (levels.length === 0) {
    return "";
  }

  const parts: string[] = [];

  for (const level of levels) {
    parts.push(`\n<!-- LEVEL ${level.level}: ${level.name} -->\n${level.content}\n`);
  }

  return parts.join("\n");
}

/**
 * Determine if reflection should be triggered based on observation tokens
 *
 * @param observationTokens - Current observation tokens
 * @param record - Observational memory record
 * @returns true if reflection should be triggered
 */
export function shouldReflect(observationTokens: number, record: ObservationalMemory): boolean {
  const config = (record.config ?? {}) as ObservationalMemoryConfig;
  const reflectionThreshold = config.reflectionThreshold ?? 40000;
  return observationTokens >= reflectionThreshold;
}

/**
 * Trigger reflection to condense observations
 *
 * @param record - Observational memory record
 * @param model - Language model for reflection
 * @returns Updated record with reflection
 */
export async function triggerReflection(
  record: ObservationalMemory,
  model: LanguageModelV3
): Promise<ObservationalMemory> {
  const ownerId = process.env.INSTANCE_ID || "default-instance";

  // Acquire lock for reflection
  const lockResult = await observationalMemoryStorage.acquireLock(record.id, ownerId);

  if (!lockResult.success) {
    // Another instance is reflecting, skip
    return record;
  }

  try {
    // Set reflecting flag
    await observationalMemoryStorage.updateObservationalMemory(record.id, {
      isReflecting: true,
    });

    const input: ReflectorInput = {
      activeObservations: record.active_observations ?? "",
    };

    const result = await callReflectorAgent(input, model);

    // Create reflection record
    await reflectionStorage.createReflection({
      id: crypto.randomUUID(),
      threadId: record.thread_id ?? undefined,
      resourceId: record.resource_id ?? undefined,
      content: result.observations,
      mergedFrom: [],
      originType: "reflection",
      generationCount: (record.generation_count ?? 0) + 1,
      tokenCount: result.tokenCount,
    });

    // Update observational memory with new generation
    const updatedRecord = await observationalMemoryStorage.updateObservationalMemory(record.id, {
      activeObservations: result.observations,
      isReflecting: false,
      generationCount: (record.generation_count ?? 0) + 1,
    });

    // Update thread metadata with current-task and suggested-response
    if (result.currentTask || result.suggestedResponse) {
      // This would require thread storage update - placeholder for now
    }

    return updatedRecord ?? record;
  } catch (error) {
    // Clear flag on error
    await observationalMemoryStorage.updateObservationalMemory(record.id, {
      isReflecting: false,
    });
    throw error;
  } finally {
    // Release lock
    if (lockResult.operationId) {
      await observationalMemoryStorage.releaseLock(record.id, ownerId, lockResult.operationId);
    }
  }
}
