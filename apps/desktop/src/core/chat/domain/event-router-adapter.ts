/**
 * Event Router Adapter
 *
 * Bridges new domain stores with legacy SSE event handling.
 * Transforms DirectoryStore events into domain store operations.
 *
 * Phase 2: SSE & Data Flow Integration
 * Updated for Batch 2: Data Integrity - includes event ordering and deduplication
 * Updated for Phase 3: Streaming Reconciliation Hardening - optimistic entity cleanup
 */

import { createLogger } from "@/core/shared/logger";
import type { MessageActions } from "@/state/stores/message-store";
import type { PartActions } from "@/state/stores/part-store";
import type { PermissionActions } from "@/state/stores/permission-store";
import type { QuestionActions } from "@/state/stores/question-store";
import type {
  SessionInfo as DomainSessionInfo,
  SessionActions,
} from "@/state/stores/session-store";
import { EventDeduplicator } from "@sakti-code/shared/event-deduplication";
import { validateEventComprehensive } from "@sakti-code/shared/event-guards";
import { EventOrderingBuffer } from "@sakti-code/shared/event-ordering";
import type { Part, ServerEvent } from "@sakti-code/shared/event-types";
import { recordChatPerfCounter } from "../services/chat-perf-telemetry";
import { type OptimisticMetadata } from "./correlation";
import {
  findOrphanedOptimisticEntities,
  reconcileMessages,
  reconcileParts,
} from "./reconciliation";

/** Helper to check if an entity has optimistic metadata */
function hasOptimisticMetadata(entity: { metadata?: unknown }): boolean {
  const metadata = entity.metadata as OptimisticMetadata | undefined;
  return metadata?.optimistic === true;
}

const logger = createLogger("event-router-adapter");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOptimisticFlag(metadata: unknown): boolean {
  return isRecord(metadata) && metadata.optimistic === true;
}

function omitTransientMetadata(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "__eventSequence" || key === "__eventTimestamp") continue;
    result[key] = omitTransientMetadata(entry);
  }
  return result;
}

function normalizePartForComparison(part: Part): Record<string, unknown> {
  const candidate = { ...(part as Record<string, unknown>) };
  if ("metadata" in candidate) {
    candidate.metadata = omitTransientMetadata(candidate.metadata);
  }
  return candidate;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function partsEquivalentIgnoringTransientMetadata(left: Part, right: Part): boolean {
  return (
    stableSerialize(normalizePartForComparison(left)) ===
    stableSerialize(normalizePartForComparison(right))
  );
}

function normalizeMessageRole(role: unknown): "user" | "assistant" | "system" {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "assistant";
}

function parseSession(input: unknown): DomainSessionInfo | undefined {
  if (!isRecord(input)) return undefined;

  const sessionId =
    typeof input.sessionId === "string"
      ? input.sessionId
      : typeof input.id === "string"
        ? input.id
        : undefined;
  if (!sessionId) return undefined;

  return {
    sessionID: sessionId,
    directory:
      typeof (input as { directory?: string }).directory === "string"
        ? (input as { directory: string }).directory
        : "default",
  };
}

function toSessionStatus(
  status: unknown
):
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | undefined {
  if (!status) return undefined;

  if (status === "idle") return { type: "idle" };
  if (status === "running") return { type: "busy" };
  if (status === "error") return { type: "idle" };

  if (!isRecord(status) || typeof status.type !== "string") return undefined;

  if (status.type === "idle" || status.type === "busy") {
    return { type: status.type };
  }

  if (
    status.type === "retry" &&
    typeof status.attempt === "number" &&
    typeof status.message === "string" &&
    typeof status.next === "number"
  ) {
    return {
      type: "retry",
      attempt: status.attempt,
      message: status.message,
      next: status.next,
    };
  }

  return undefined;
}

function forwardAuxiliaryEvent(event: ServerEvent): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent("sakti-code:sse-event", { detail: event }));
  window.dispatchEvent(new CustomEvent(`sakti-code:${event.type}`, { detail: event.properties }));
}

function parseMessageInfo(input: unknown):
  | {
      id: string;
      role: "user" | "assistant" | "system";
      sessionID?: string;
      time?: { created: number; completed?: number };
      parentID?: string;
      model?: string;
      provider?: string;
    }
  | undefined {
  if (!isRecord(input)) return undefined;
  if (typeof input.id !== "string") return undefined;

  const time = isRecord(input.time)
    ? {
        created: typeof input.time.created === "number" ? input.time.created : Date.now(),
        completed: typeof input.time.completed === "number" ? input.time.completed : undefined,
      }
    : undefined;

  return {
    id: input.id,
    role: normalizeMessageRole(input.role),
    sessionID: typeof input.sessionID === "string" ? input.sessionID : undefined,
    time,
    parentID:
      typeof input.parentID === "string"
        ? input.parentID
        : typeof input.parentId === "string"
          ? input.parentId
          : undefined,
    model:
      typeof input.model === "string"
        ? input.model
        : typeof input.modelID === "string"
          ? input.modelID
          : undefined,
    provider:
      typeof input.provider === "string"
        ? input.provider
        : typeof input.providerID === "string"
          ? input.providerID
          : undefined,
  };
}

function attachPartEventMetadata(part: Part, event: ServerEvent): Part {
  const metadataCandidate = (part as { metadata?: unknown }).metadata;
  const existingMetadata = isRecord(metadataCandidate) ? metadataCandidate : {};

  return {
    ...part,
    metadata: {
      ...existingMetadata,
      __eventSequence: event.sequence,
      __eventTimestamp: event.timestamp,
    },
  };
}

// ============================================================================
// Event Ordering and Deduplication (Batch 2: Data Integrity)
// ============================================================================

/**
 * Global event ordering buffer instance
 * Ensures events are processed in sequence order per session
 */
const orderingBuffer = new EventOrderingBuffer({
  timeoutMs: 30000,
  maxQueueSize: 1000,
});

/**
 * Global event deduplicator instance
 * Prevents duplicate event processing
 */
const deduplicator = new EventDeduplicator({
  maxSize: 1000,
});

/**
 * Buffer parts that arrive before their parent message exists.
 * These are replayed once the message is created.
 */
const pendingPartsByMessage = new Map<string, Part[]>();
const retryStateBySession = new Map<string, { seenRetry: boolean; lastSignature?: string }>();

/**
 * Process a single event after validation, ordering, and deduplication
 */
function processEvent(
  event: ServerEvent,
  messageActions: MessageActions,
  partActions: PartActions,
  sessionActions: SessionActions,
  permissionActions?: PermissionActions,
  questionActions?: QuestionActions
): void {
  switch (event.type) {
    case "session.created":
    case "session.updated": {
      const props = isRecord(event.properties) ? event.properties : {};
      const parsed = parseSession(props.info);
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
      const session: DomainSessionInfo | undefined =
        parsed ??
        (sessionID
          ? {
              sessionID,
              directory: typeof props.directory === "string" ? props.directory : "default",
            }
          : undefined);
      if (session) {
        sessionActions.upsert(session);
      }

      if (sessionID) {
        const status = toSessionStatus(props.status);
        if (status) {
          sessionActions.setStatus(sessionID, status);
        }
      }
      break;
    }

    case "message.updated": {
      const props = isRecord(event.properties) ? event.properties : {};
      const info = parseMessageInfo(props.info);
      if (!info) break;
      const sessionID =
        info.sessionID ??
        (typeof props.sessionID === "string" ? props.sessionID : undefined) ??
        (typeof event.sessionID === "string" ? event.sessionID : undefined) ??
        (() => {
          if (!info.parentID) return undefined;
          return (messageActions.getById(info.parentID) as { sessionID?: string } | undefined)
            ?.sessionID;
        })();
      if (!sessionID) break;

      if (!sessionActions.getById(sessionID)) {
        sessionActions.upsert({
          sessionID,
          directory:
            typeof props.directory === "string"
              ? props.directory
              : typeof event.directory === "string"
                ? event.directory
                : "default",
        });
      }

      // Convert MessageInfo to MessageWithId format expected by store
      const messageWithId = {
        id: info.id,
        role: info.role,
        sessionID,
        time: info.time,
        parentID: info.parentID,
        model: info.model,
        provider: info.provider,
      };

      // Get optimistic messages for this session for reconciliation
      const existingMessages = messageActions.getBySession(sessionID);
      const optimisticMessages = existingMessages.filter(m =>
        hasOptimisticMetadata(m as { metadata?: unknown })
      );

      // Reconcile canonical message with optimistic messages
      const result = reconcileMessages([messageWithId], optimisticMessages);

      // Upsert canonical message first so part re-association passes FK validation.
      const canonicalMessage = result.toUpsert[0];
      if (canonicalMessage) {
        messageActions.upsert(canonicalMessage);
      }

      // Remove matched optimistic messages.
      // Exact-ID matches must not be removed because remove() cascades parts.
      for (const id of result.toRemove) {
        if (id === info.id) {
          logger.debug("Skipping remove for exact-ID message reconciliation", {
            messageId: id,
          });
          continue;
        }

        // Preserve streamed parts by moving them from optimistic message ID to canonical ID.
        const optimisticParts = partActions.getByMessage(id);
        for (const optimisticPart of optimisticParts) {
          if (!optimisticPart.id) continue;
          partActions.remove(optimisticPart.id, id);
          partActions.upsert({
            ...optimisticPart,
            messageID: info.id,
          });
        }

        logger.debug("Removing matched optimistic message", {
          optimisticId: id,
          canonicalId: info.id,
        });
        messageActions.remove(id);
      }

      // Log diagnostics
      if (result.stats.matched > 0 || result.stats.stale > 0) {
        logger.debug("Message reconciliation completed", {
          canonicalId: info.id,
          sessionID,
          removedOptimistic: result.toRemove,
          stats: result.stats,
        });
      }

      const pendingParts = pendingPartsByMessage.get(info.id);
      if (pendingParts && pendingParts.length > 0) {
        for (const pendingPart of pendingParts) {
          try {
            partActions.upsert(pendingPart);
          } catch (error) {
            logger.error("Failed to apply buffered part after message creation", error as Error, {
              messageID: info.id,
              partID: pendingPart.id,
            });
          }
        }
        pendingPartsByMessage.delete(info.id);
      }
      break;
    }

    case "message.part.updated": {
      const props = isRecord(event.properties) ? event.properties : {};
      const rawPart = isRecord(props.part) ? (props.part as Part) : undefined;
      const part = rawPart ? attachPartEventMetadata(rawPart, event) : undefined;
      if (
        !part ||
        typeof part.id !== "string" ||
        typeof part.messageID !== "string" ||
        typeof part.sessionID !== "string"
      ) {
        break;
      }

      if (!messageActions.getById(part.messageID)) {
        const queue = pendingPartsByMessage.get(part.messageID) ?? [];
        const existingIndex = queue.findIndex(item => item.id === part.id);
        if (existingIndex >= 0) {
          queue[existingIndex] = part;
        } else {
          queue.push(part);
        }
        pendingPartsByMessage.set(part.messageID, queue);
        break;
      }

      const currentPart = partActions.getById(part.id);
      const currentMetadata = (currentPart as { metadata?: unknown } | undefined)?.metadata;
      const isCurrentOptimistic = hasOptimisticFlag(currentMetadata);
      if (
        currentPart &&
        !isCurrentOptimistic &&
        partsEquivalentIgnoringTransientMetadata(currentPart, part)
      ) {
        break;
      }

      // Get optimistic parts for this message for reconciliation
      const existingParts = partActions.getByMessage(part.messageID);
      const optimisticParts = existingParts.filter(p =>
        hasOptimisticMetadata(p as { metadata?: unknown })
      );

      // Reconcile canonical part with optimistic parts
      const result = reconcileParts([part], optimisticParts);

      // Remove matched optimistic parts
      for (const id of result.toRemove) {
        if (id === part.id) {
          logger.debug("Skipping remove for exact-ID part reconciliation", {
            partId: id,
          });
          continue;
        }
        logger.debug("Removing matched optimistic part", {
          optimisticId: id,
          canonicalId: part.id,
        });
        partActions.remove(id, part.messageID);
      }

      // Upsert canonical part (without optimistic metadata)
      const canonicalPart = result.toUpsert[0];
      if (canonicalPart) {
        partActions.upsert(canonicalPart);
      }

      // Log diagnostics
      if (result.stats.matched > 0 || result.stats.stale > 0) {
        logger.debug("Part reconciliation completed", {
          canonicalId: part.id,
          messageID: part.messageID,
          removedOptimistic: result.toRemove,
          stats: result.stats,
        });
      }
      break;
    }

    case "message.part.removed": {
      const props = isRecord(event.properties) ? event.properties : {};
      const messageID = typeof props.messageID === "string" ? props.messageID : undefined;
      const partID = typeof props.partID === "string" ? props.partID : undefined;
      if (!messageID || !partID) break;
      partActions.remove(partID, messageID);
      break;
    }

    case "permission.asked":
      if (permissionActions) {
        const props = isRecord(event.properties) ? event.properties : {};
        const requestId = typeof props.id === "string" ? props.id : undefined;
        const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
        const permission = typeof props.permission === "string" ? props.permission : "tool";
        const tool = isRecord(props.tool) ? props.tool : {};
        const metadata = isRecord(props.metadata) ? props.metadata : {};
        const patterns = Array.isArray(props.patterns)
          ? props.patterns.filter(
              (pattern: unknown): pattern is string => typeof pattern === "string"
            )
          : [];

        if (requestId && sessionID) {
          permissionActions.add({
            id: requestId,
            sessionID,
            messageID:
              typeof tool.messageID === "string" ? tool.messageID : `permission:${requestId}`,
            toolName: permission,
            args: metadata,
            patterns,
            description:
              patterns.length > 0 ? `Requires permission for: ${patterns.join(", ")}` : undefined,
            status: "pending",
            timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
            callID: typeof tool.callID === "string" ? tool.callID : undefined,
          });
        }
      }
      forwardAuxiliaryEvent(event);
      break;

    case "permission.replied":
      if (permissionActions) {
        const props = isRecord(event.properties) ? event.properties : {};
        const requestID = typeof props.requestID === "string" ? props.requestID : undefined;
        const reply = typeof props.reply === "string" ? props.reply : undefined;
        if (requestID) {
          permissionActions.resolve(requestID, reply !== "reject");
        }
      }
      forwardAuxiliaryEvent(event);
      break;

    case "question.asked":
      if (questionActions) {
        const props = isRecord(event.properties) ? event.properties : {};
        const requestId = typeof props.id === "string" ? props.id : undefined;
        const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
        const tool = isRecord(props.tool) ? props.tool : {};
        const questions = Array.isArray(props.questions) ? props.questions : [];

        const normalizedQuestions: {
          header?: string;
          question: string;
          options?: { label: string; description?: string }[];
          multiple?: boolean;
        }[] = [];
        for (const question of questions) {
          if (typeof question === "string") {
            normalizedQuestions.push({ question });
            continue;
          }
          if (!isRecord(question) || typeof question.question !== "string") {
            continue;
          }

          const options = Array.isArray(question.options)
            ? question.options
                .map(option => {
                  if (typeof option === "string") return { label: option };
                  if (!isRecord(option) || typeof option.label !== "string") return undefined;
                  return {
                    label: option.label,
                    description:
                      typeof option.description === "string" ? option.description : undefined,
                  };
                })
                .filter((option): option is { label: string; description?: string } =>
                  Boolean(option)
                )
            : undefined;

          normalizedQuestions.push({
            header: typeof question.header === "string" ? question.header : undefined,
            question: question.question,
            options,
            multiple: question.multiple === true,
          });
        }

        const primaryQuestion = normalizedQuestions[0];
        const questionText = primaryQuestion?.question ?? "Question";
        const options = primaryQuestion?.options?.map(option => option.label);

        if (requestId && sessionID) {
          questionActions.add({
            id: requestId,
            sessionID,
            messageID:
              typeof tool.messageID === "string" ? tool.messageID : `question:${requestId}`,
            questions:
              normalizedQuestions.length > 0
                ? normalizedQuestions
                : [{ question: questionText, options: options?.map(label => ({ label })) }],
            question: questionText,
            options,
            status: "pending",
            timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
            callID: typeof tool.callID === "string" ? tool.callID : undefined,
          });
        }
      }
      forwardAuxiliaryEvent(event);
      break;

    case "question.replied":
      if (questionActions) {
        const props = isRecord(event.properties) ? event.properties : {};
        const requestID = typeof props.requestID === "string" ? props.requestID : undefined;
        if (requestID) {
          questionActions.answer(requestID, props.reply);
        }
      }
      forwardAuxiliaryEvent(event);
      break;

    case "question.rejected":
      if (questionActions) {
        const props = isRecord(event.properties) ? event.properties : {};
        const requestID = typeof props.requestID === "string" ? props.requestID : undefined;
        if (requestID) {
          questionActions.answer(requestID, {
            rejected: true,
            reason: typeof props.reason === "string" ? props.reason : undefined,
          });
        }
      }
      forwardAuxiliaryEvent(event);
      break;

    case "session.status": {
      const props = isRecord(event.properties) ? event.properties : {};
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
      const status = toSessionStatus(props.status);
      if (sessionID && status) {
        if (!sessionActions.getById(sessionID)) {
          sessionActions.upsert({
            sessionID,
            directory:
              typeof props.directory === "string"
                ? props.directory
                : typeof event.directory === "string"
                  ? event.directory
                  : "default",
          });
        }
        sessionActions.setStatus(sessionID, status);

        const retryState = retryStateBySession.get(sessionID) ?? { seenRetry: false };
        if (status.type === "retry") {
          const signature = `${status.attempt}:${status.next}:${status.message}`;
          if (retryState.lastSignature !== signature) {
            recordChatPerfCounter("retryAttempts");
          }
          retryState.seenRetry = true;
          retryState.lastSignature = signature;
          retryStateBySession.set(sessionID, retryState);
        } else if (status.type === "idle" && retryState.seenRetry) {
          const messages = messageActions.getBySession(sessionID);
          const latestAssistant = [...messages]
            .reverse()
            .find(message => message.role === "assistant");
          const latestAssistantParts = latestAssistant
            ? partActions.getByMessage(latestAssistant.id)
            : [];
          const hasErrorPart = latestAssistantParts.some(part => part.type === "error");
          const messageError =
            latestAssistant && "error" in latestAssistant ? latestAssistant.error : undefined;
          const hasMessageError =
            typeof messageError === "string" || typeof messageError === "object";
          if (hasErrorPart || hasMessageError) {
            recordChatPerfCounter("retryExhausted");
          } else {
            recordChatPerfCounter("retryRecovered");
          }
          retryStateBySession.set(sessionID, { seenRetry: false, lastSignature: undefined });
        }

        // Clean up orphaned optimistic entities when session goes idle
        if (status.type === "idle") {
          const messages = messageActions.getBySession(sessionID);
          const parts = messages.flatMap(message => partActions.getByMessage(message.id));

          const orphanedPartIds = findOrphanedOptimisticEntities(
            parts
              .filter(part => typeof part.id === "string")
              .map(part => ({
                id: part.id as string,
                metadata: (part as { metadata?: unknown }).metadata,
              }))
          );
          for (const partId of orphanedPartIds) {
            const part = partActions.getById(partId);
            if (!part?.messageID) continue;
            logger.info("Removing orphaned optimistic part", {
              partId,
              messageID: part.messageID,
              sessionID,
            });
            partActions.remove(partId, part.messageID);
          }

          const orphanedIds = findOrphanedOptimisticEntities(
            messages.map(m => ({ id: m.id, metadata: (m as { metadata?: unknown }).metadata }))
          );

          for (const messageId of orphanedIds) {
            logger.info("Removing orphaned optimistic message", { messageId, sessionID });

            // Remove parts first (cascade)
            const parts = partActions.getByMessage(messageId);
            for (const part of parts) {
              partActions.remove(part.id!, messageId);
            }

            // Remove message
            messageActions.remove(messageId);
          }
        }
      }
      break;
    }
  }
}

/**
 * Apply SSE event to domain stores with ordering and deduplication
 *
 * @param event - Server event from SSE
 * @param messageActions - Message store actions
 * @param partActions - Part store actions
 * @param sessionActions - Session store actions
 * @returns Array of events that were processed (may be empty if queued)
 */
export async function applyEventToStores(
  event: ServerEvent<string, Record<string, unknown>>,
  messageActions: MessageActions,
  partActions: PartActions,
  sessionActions: SessionActions,
  permissionActions?: PermissionActions,
  questionActions?: QuestionActions
): Promise<ServerEvent<string, Record<string, unknown>>[]> {
  // Step 1: Comprehensive validation
  const validation = validateEventComprehensive(event);
  if (!validation.valid) {
    logger.warn("Event validation failed", {
      error: validation.error,
      eventType: event.type,
      eventId: event.eventId,
    });
    return [];
  }

  // Step 2: Deduplication check
  if (deduplicator.isDuplicate(event.eventId)) {
    return [];
  }

  // Step 3: Ordering - add to buffer and get processable events
  const eventsToProcess = await orderingBuffer.addEvent(event);

  // Step 4: Process all events that are now ready
  for (const evt of eventsToProcess) {
    try {
      processEvent(
        evt,
        messageActions,
        partActions,
        sessionActions,
        permissionActions,
        questionActions
      );
    } catch (error) {
      logger.error("Failed to process event", error as Error, {
        eventId: evt.eventId,
        eventType: evt.type,
      });
    }
  }

  return eventsToProcess;
}

/**
 * Get current ordering buffer statistics
 * Useful for debugging and monitoring
 */
export function getOrderingStats(sessionId?: string): Record<string, unknown> {
  if (sessionId) {
    return orderingBuffer.getStats(sessionId);
  }

  // Return stats for all sessions
  const allStats: Record<string, unknown> = {};
  // Note: We'd need to expose session IDs from the buffer for this
  return allStats;
}

/**
 * Get deduplicator statistics
 */
export function getDeduplicatorStats(): ReturnType<typeof deduplicator.getStats> {
  return deduplicator.getStats();
}

/**
 * Clear all ordering and deduplication state
 * Useful for testing or session reset
 */
export function clearEventProcessingState(): void {
  orderingBuffer.clear();
  deduplicator.clear();
  pendingPartsByMessage.clear();
  logger.info("Event processing state cleared");
}

/**
 * Clear state for a specific session
 */
export function clearSessionState(sessionId: string): void {
  orderingBuffer.clearSession(sessionId);
  for (const [messageID, parts] of pendingPartsByMessage.entries()) {
    const remaining = parts.filter(part => part.sessionID !== sessionId);
    if (remaining.length === 0) {
      pendingPartsByMessage.delete(messageID);
      continue;
    }
    pendingPartsByMessage.set(messageID, remaining);
  }
  logger.info("Session state cleared", { sessionId });
}

// Re-export for consumers who need direct access
export { EventDeduplicator, EventOrderingBuffer };
