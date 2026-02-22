/**
 * Reconciliation Fixtures for Testing
 *
 * Provides test data for reconciliation testing between optimistic and canonical entities.
 * Based on existing patterns in turn-fixtures.ts and data-integrity.ts
 */

import {
  generateMessageCorrelationKey,
  generatePartCorrelationKey,
  type OptimisticMetadata,
} from "@/core/chat/domain/correlation";
import type { MessageWithId } from "@/core/state/stores/message-store";
import type { Part } from "@sakti-code/shared/event-types";
import { v7 as uuidv7 } from "uuid";

// ============================================================================
// Part Fixtures
// ============================================================================

/**
 * Create an optimistic text part for testing
 */
export function createOptimisticTextPart(
  messageId: string,
  sessionId: string,
  text: string,
  overrides?: Partial<Part> & { timestamp?: number }
): Part {
  const id = overrides?.id ?? `${messageId}-text-opt`;
  const timestamp = overrides?.timestamp ?? Date.now();

  // Extract timestamp from overrides to avoid spreading it into the part
  const { timestamp: _, ...partOverrides } = overrides ?? {};

  const part: Part = {
    id,
    type: "text",
    messageID: messageId,
    sessionID: sessionId,
    text,
    time: { start: timestamp, end: timestamp },
    ...partOverrides,
    metadata: {
      optimistic: true,
      optimisticSource: "useChat",
      correlationKey: generatePartCorrelationKey({
        messageID: messageId,
        partType: "text",
      }),
      timestamp, // Use the provided timestamp
    },
  };

  return part;
}

/**
 * Create a canonical text part for testing (from SSE)
 */
export function createCanonicalTextPart(
  messageId: string,
  sessionId: string,
  text: string,
  canonicalId: string,
  overrides?: Partial<Part>
): Part {
  const timestamp = Date.now();

  const part: Part = {
    id: canonicalId,
    type: "text",
    messageID: messageId,
    sessionID: sessionId,
    text,
    time: { start: timestamp, end: timestamp },
    ...overrides,
    // Note: canonical parts do NOT have optimistic metadata
  };

  return part;
}

/**
 * Create an optimistic tool part for testing
 */
export function createOptimisticToolPart(
  messageId: string,
  sessionId: string,
  toolName: string,
  callID: string,
  status: "running" | "completed",
  overrides?: Partial<Part> & { timestamp?: number }
): Part {
  const id = overrides?.id ?? `${callID}-tool-opt`;
  const timestamp = overrides?.timestamp ?? Date.now();

  // Extract timestamp from overrides to avoid spreading it into the part
  const { timestamp: _, ...partOverrides } = overrides ?? {};

  const part: Part = {
    id,
    type: "tool",
    messageID: messageId,
    sessionID: sessionId,
    tool: toolName,
    callID,
    state: {
      status,
      ...(status === "running" ? { input: {} } : { output: "Tool completed" }),
    },
    time: { start: timestamp, end: timestamp },
    ...partOverrides,
    metadata: {
      optimistic: true,
      optimisticSource: "useChat",
      correlationKey: generatePartCorrelationKey({
        messageID: messageId,
        partType: "tool",
        callID,
      }),
      timestamp, // Use the provided timestamp
    },
  };

  return part;
}

/**
 * Create a canonical tool part for testing (from SSE)
 */
export function createCanonicalToolPart(
  messageId: string,
  sessionId: string,
  toolName: string,
  callID: string,
  canonicalId: string,
  status: "completed" | "error",
  overrides?: Partial<Part>
): Part {
  const timestamp = Date.now();
  const overrideState = overrides?.state as Record<string, unknown> | undefined;
  const overrideError =
    typeof overrideState?.error === "string" ? overrideState.error : "Tool error";

  const part: Part = {
    id: canonicalId,
    type: "tool",
    messageID: messageId,
    sessionID: sessionId,
    tool: toolName,
    callID,
    state: {
      status,
      ...(status === "completed" ? { output: overrides?.output ?? "Tool output" } : {}),
      ...(status === "error" ? { error: overrideError } : {}),
    },
    time: { start: timestamp, end: timestamp },
    ...overrides,
    // Note: canonical parts do NOT have optimistic metadata
  };

  return part;
}

/**
 * Create an optimistic reasoning part for testing
 */
export function createOptimisticReasoningPart(
  messageId: string,
  sessionId: string,
  reasoningId: string,
  text: string,
  overrides?: Partial<Part> & { timestamp?: number }
): Part {
  const id = overrides?.id ?? `${reasoningId}-reasoning-opt`;
  const timestamp = overrides?.timestamp ?? Date.now();

  // Extract timestamp from overrides to avoid spreading it into the part
  const { timestamp: _, ...partOverrides } = overrides ?? {};

  const part: Part = {
    id,
    type: "reasoning",
    messageID: messageId,
    sessionID: sessionId,
    text,
    reasoningId,
    time: { start: timestamp, end: timestamp },
    ...partOverrides,
    metadata: {
      optimistic: true,
      optimisticSource: "useChat",
      correlationKey: generatePartCorrelationKey({
        messageID: messageId,
        partType: "reasoning",
        reasoningId,
      }),
      timestamp, // Use the provided timestamp
    },
  };

  return part;
}

/**
 * Create a canonical reasoning part for testing (from SSE)
 */
export function createCanonicalReasoningPart(
  messageId: string,
  sessionId: string,
  reasoningId: string,
  canonicalId: string,
  text: string,
  overrides?: Partial<Part>
): Part {
  const timestamp = Date.now();

  const part: Part = {
    id: canonicalId,
    type: "reasoning",
    messageID: messageId,
    sessionID: sessionId,
    text,
    reasoningId,
    time: { start: timestamp, end: timestamp },
    ...overrides,
    // Note: canonical parts do NOT have optimistic metadata
  };

  return part;
}

// ============================================================================
// Message Fixtures
// ============================================================================

/**
 * Create an optimistic message for testing
 */
export function createOptimisticMessage(
  sessionId: string,
  role: "user" | "assistant",
  parentId?: string,
  overrides?: Partial<MessageWithId> & { timestamp?: number }
): MessageWithId {
  const id = overrides?.id ?? uuidv7();
  const timestamp = overrides?.timestamp ?? Date.now();

  // Extract timestamp from overrides to avoid spreading it into the message
  const { timestamp: _, ...messageOverrides } = overrides ?? {};

  const message: MessageWithId = {
    id,
    role,
    sessionID: sessionId,
    time: { created: timestamp },
    ...(parentId ? { parentID: parentId } : {}),
    ...messageOverrides,
    metadata: {
      optimistic: true,
      optimisticSource: role === "user" ? "userAction" : "useChat",
      correlationKey: generateMessageCorrelationKey({
        role,
        createdAt: timestamp,
        parentID: parentId,
      }),
      timestamp, // Use the provided timestamp
    },
  };

  return message;
}

/**
 * Create a canonical message for testing (from SSE)
 */
export function createCanonicalMessage(
  sessionId: string,
  role: "user" | "assistant",
  canonicalId: string,
  parentId?: string,
  overrides?: Partial<MessageWithId>
): MessageWithId {
  const timestamp = Date.now();

  const message: MessageWithId = {
    id: canonicalId,
    role,
    sessionID: sessionId,
    time: { created: timestamp },
    ...(parentId ? { parentID: parentId } : {}),
    ...overrides,
    // Note: canonical messages do NOT have optimistic metadata
  };

  return message;
}

// ============================================================================
// Scenario Fixtures
// ============================================================================

export interface StreamingTextScenario {
  /** Optimistic parts created during streaming */
  optimistic: Part[];
  /** Canonical parts received from SSE */
  canonical: Part[];
  /** Expected matches between optimistic and canonical */
  expectedMatches: Array<{ optimisticId: string; canonicalId: string; strategy: string }>;
  /** Parts that should remain after reconciliation (unmatched canonical) */
  expectedRemaining: string[];
  /** Parts that should be removed after reconciliation (matched optimistic) */
  expectedRemoved: string[];
}

/**
 * Create a streaming text scenario for testing
 *
 * Scenario: User sends message, assistant responds with streaming text.
 * Optimistic parts are created during streaming, canonical parts arrive via SSE.
 */
export function createStreamingTextScenario(sessionId?: string): StreamingTextScenario {
  const sid = sessionId ?? uuidv7();
  const messageId = uuidv7();
  const optimisticId = `${messageId}-text-opt`;
  const canonicalId = `${messageId}-text`;

  return {
    optimistic: [
      createOptimisticTextPart(messageId, sid, "Streaming text...", { id: optimisticId }),
    ],
    canonical: [createCanonicalTextPart(messageId, sid, "Final text content", canonicalId)],
    expectedMatches: [{ optimisticId, canonicalId, strategy: "message-type" }],
    expectedRemaining: [canonicalId],
    expectedRemoved: [optimisticId],
  };
}

export interface CompletedToolScenario {
  /** Optimistic parts created during streaming */
  optimistic: Part[];
  /** Canonical parts received from SSE */
  canonical: Part[];
  /** Expected matches between optimistic and canonical */
  expectedMatches: Array<{ optimisticId: string; canonicalId: string; strategy: string }>;
  /** Parts that should remain after reconciliation */
  expectedRemaining: string[];
  /** Parts that should be removed after reconciliation */
  expectedRemoved: string[];
}

/**
 * Create a completed tool scenario for testing
 *
 * Scenario: Tool starts optimistically, then completes via SSE with same callID.
 */
export function createCompletedToolScenario(sessionId?: string): CompletedToolScenario {
  const sid = sessionId ?? uuidv7();
  const messageId = uuidv7();
  const callID = uuidv7();
  const optimisticId = `${callID}-tool-opt`;
  const canonicalId = `${callID}-tool`;

  return {
    optimistic: [
      createOptimisticToolPart(messageId, sid, "read_file", callID, "running", {
        id: optimisticId,
      }),
    ],
    canonical: [
      createCanonicalToolPart(messageId, sid, "read_file", callID, canonicalId, "completed", {
        state: { status: "completed", output: "File contents..." },
      }),
    ],
    expectedMatches: [{ optimisticId, canonicalId, strategy: "message-callid" }],
    expectedRemaining: [canonicalId],
    expectedRemoved: [optimisticId],
  };
}

export interface MixedScenario {
  /** Optimistic parts created during streaming */
  optimistic: Part[];
  /** Canonical parts received from SSE */
  canonical: Part[];
  /** Expected matches between optimistic and canonical */
  expectedMatches: Array<{ optimisticId: string; canonicalId: string; strategy: string }>;
  /** Parts that should remain after reconciliation */
  expectedRemaining: string[];
  /** Parts that should be removed after reconciliation */
  expectedRemoved: string[];
  /** Optimistic parts that should remain (still streaming) */
  unmatchedOptimistic: string[];
}

/**
 * Create a mixed scenario for testing
 *
 * Scenario: Multiple parts of different types, some matching, some not.
 */
export function createMixedScenario(sessionId?: string): MixedScenario {
  const sid = sessionId ?? uuidv7();
  const messageId = uuidv7();
  const callID1 = uuidv7();
  const callID2 = uuidv7();
  const reasoningId = uuidv7();

  // IDs
  const textOptId = `${messageId}-text-opt`;
  const textCanId = `${messageId}-text`;
  const tool1OptId = `${callID1}-tool-opt`;
  const tool1CanId = `${callID1}-tool`;
  const tool2OptId = `${callID2}-tool-opt`;
  // tool2 has no canonical yet (still running)
  const reasoningOptId = `${reasoningId}-reasoning-opt`;
  const reasoningCanId = `${reasoningId}-reasoning`;

  return {
    optimistic: [
      createOptimisticTextPart(messageId, sid, "Streaming...", { id: textOptId }),
      createOptimisticToolPart(messageId, sid, "read_file", callID1, "running", {
        id: tool1OptId,
      }),
      createOptimisticToolPart(messageId, sid, "write_file", callID2, "running", {
        id: tool2OptId,
      }),
      createOptimisticReasoningPart(messageId, sid, reasoningId, "Thinking...", {
        id: reasoningOptId,
      }),
    ],
    canonical: [
      createCanonicalTextPart(messageId, sid, "Final text", textCanId),
      createCanonicalToolPart(messageId, sid, "read_file", callID1, tool1CanId, "completed"),
      createCanonicalReasoningPart(messageId, sid, reasoningId, reasoningCanId, "Final reasoning"),
    ],
    expectedMatches: [
      { optimisticId: textOptId, canonicalId: textCanId, strategy: "message-type" },
      { optimisticId: tool1OptId, canonicalId: tool1CanId, strategy: "message-callid" },
      {
        optimisticId: reasoningOptId,
        canonicalId: reasoningCanId,
        strategy: "message-reasoningid",
      },
    ],
    expectedRemaining: [textCanId, tool1CanId, reasoningCanId],
    expectedRemoved: [textOptId, tool1OptId, reasoningOptId],
    unmatchedOptimistic: [tool2OptId], // Still running
  };
}

export interface StaleOptimisticScenario {
  /** Messages with varying ages */
  messages: MessageWithId[];
  /** IDs of messages that should be considered stale */
  staleIds: string[];
  /** IDs of messages that should still be valid */
  validIds: string[];
}

/**
 * Create a stale optimistic scenario for testing
 *
 * Scenario: Some optimistic messages are old enough to be considered stale.
 * Uses CORRELATION_TIME_WINDOW_MS (30 seconds) as the threshold.
 */
export function createStaleOptimisticScenario(sessionId?: string): StaleOptimisticScenario {
  const sid = sessionId ?? uuidv7();
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const tenSecondsAgo = now - 10 * 1000; // Within CORRELATION_TIME_WINDOW_MS (30s)

  return {
    messages: [
      // Stale message (1 hour old) - exceeds threshold
      createOptimisticMessage(sid, "user", undefined, {
        id: "stale-user",
        timestamp: oneHourAgo,
      }),
      // Recent message (10 seconds old) - within threshold
      createOptimisticMessage(sid, "assistant", "stale-user", {
        id: "valid-assistant",
        timestamp: tenSecondsAgo,
      }),
      // Fresh message (just now) - within threshold
      createOptimisticMessage(sid, "user", undefined, {
        id: "fresh-user",
        timestamp: now,
      }),
      // Canonical message (no metadata) - not optimistic
      createCanonicalMessage(sid, "assistant", "canonical-assistant", "fresh-user"),
    ],
    staleIds: ["stale-user"],
    validIds: ["valid-assistant", "fresh-user", "canonical-assistant"],
  };
}

export interface ExactIdMatchScenario {
  /** Optimistic part with same ID as canonical */
  optimistic: Part[];
  /** Canonical part with matching ID */
  canonical: Part[];
  /** Expected match */
  expectedMatch: { optimisticId: string; canonicalId: string; strategy: string };
}

/**
 * Create an exact ID match scenario for testing
 *
 * Scenario: Optimistic and canonical parts have the same ID.
 * This should match with "exact-id" strategy.
 */
export function createExactIdMatchScenario(sessionId?: string): ExactIdMatchScenario {
  const sid = sessionId ?? uuidv7();
  const messageId = uuidv7();
  const callID = uuidv7();
  const sharedId = `shared-${callID}-tool`;

  return {
    optimistic: [
      createOptimisticToolPart(messageId, sid, "test_tool", callID, "running", {
        id: sharedId,
      }),
    ],
    canonical: [
      createCanonicalToolPart(messageId, sid, "test_tool", callID, sharedId, "completed"),
    ],
    expectedMatch: {
      optimisticId: sharedId,
      canonicalId: sharedId,
      strategy: "exact-id",
    },
  };
}

export interface MessageReconciliationScenario {
  /** Optimistic messages */
  optimistic: MessageWithId[];
  /** Canonical messages from SSE */
  canonical: MessageWithId[];
  /** Expected matches */
  expectedMatches: Array<{ optimisticId: string; canonicalId: string; strategy: string }>;
  /** Messages that should remain after reconciliation */
  expectedRemaining: string[];
  /** Messages that should be removed after reconciliation */
  expectedRemoved: string[];
}

/**
 * Create a message reconciliation scenario for testing
 *
 * Scenario: User message optimistically created, then canonical version arrives via SSE.
 * The assistant message uses exact ID matching (same ID for both optimistic and canonical).
 *
 * Note: Correlation matching requires parentID to match. When optimistic user is replaced
 * by canonical, the assistant's parentID changes. Therefore, we use exact ID matching for
 * assistant messages in this scenario.
 */
export function createMessageReconciliationScenario(
  sessionId?: string
): MessageReconciliationScenario {
  const sid = sessionId ?? uuidv7();
  const now = Date.now();

  const optUserId = "opt-user-1";
  const canUserId = "can-user-1";
  // Assistant uses same ID for exact matching (since parentID will differ after user reconciliation)
  const assistantSharedId = "shared-assistant-1";

  return {
    optimistic: [
      createOptimisticMessage(sid, "user", undefined, {
        id: optUserId,
        timestamp: now - 1000,
      }),
      createOptimisticMessage(sid, "assistant", optUserId, {
        id: assistantSharedId, // Same ID as canonical for exact matching
        timestamp: now,
      }),
    ],
    canonical: [
      createCanonicalMessage(sid, "user", canUserId, undefined, {
        time: { created: now - 1000 },
      }),
      createCanonicalMessage(sid, "assistant", assistantSharedId, canUserId, {
        // Same ID as optimistic for exact matching
        time: { created: now },
      }),
    ],
    expectedMatches: [
      { optimisticId: optUserId, canonicalId: canUserId, strategy: "parent-window-role" },
      { optimisticId: assistantSharedId, canonicalId: assistantSharedId, strategy: "exact-id" },
    ],
    expectedRemaining: [canUserId, assistantSharedId],
    expectedRemoved: [optUserId, assistantSharedId],
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a part has optimistic metadata
 */
export function isOptimisticPart(part: Part): boolean {
  const metadata = part.metadata as OptimisticMetadata | undefined;
  return metadata?.optimistic === true;
}

/**
 * Check if a message has optimistic metadata
 */
export function isOptimisticMessage(message: MessageWithId): boolean {
  const metadata = message.metadata as OptimisticMetadata | undefined;
  return metadata?.optimistic === true;
}

/**
 * Get all optimistic parts from an array
 */
export function getOptimisticParts(parts: Part[]): Part[] {
  return parts.filter(isOptimisticPart);
}

/**
 * Get all optimistic messages from an array
 */
export function getOptimisticMessages(messages: MessageWithId[]): MessageWithId[] {
  return messages.filter(isOptimisticMessage);
}
