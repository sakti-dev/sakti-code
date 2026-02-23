/**
 * Reconciliation Service Tests
 *
 * Tests for reconciling optimistic entities with canonical SSE events.
 */

import { CORRELATION_TIME_WINDOW_MS } from "@/core/chat/domain/correlation";
import {
  clearOptimisticMetadata,
  findOrphanedOptimisticEntities,
  reconcileMessages,
  reconcileParts,
} from "@/core/chat/domain/reconciliation";
import {
  createCanonicalMessage,
  createCanonicalTextPart,
  createCanonicalToolPart,
  createCompletedToolScenario,
  createExactIdMatchScenario,
  createMessageReconciliationScenario,
  createMixedScenario,
  createOptimisticMessage,
  createOptimisticTextPart,
  createOptimisticToolPart,
  createStaleOptimisticScenario,
  createStreamingTextScenario,
} from "@/fixtures/reconciliation-fixtures";
import type { Part } from "@sakti-code/shared/event-types";
import { describe, expect, it } from "vitest";

describe("reconcileParts", () => {
  describe("exact ID matching", () => {
    it("replaces optimistic part with canonical by exact ID", () => {
      const scenario = createExactIdMatchScenario();
      const result = reconcileParts(scenario.canonical, scenario.optimistic);

      expect(result.toRemove).toContain(scenario.expectedMatch.optimisticId);
      expect(result.toUpsert).toHaveLength(1);
      expect(result.toUpsert[0].id).toBe(scenario.expectedMatch.canonicalId);
      expect(result.stats.matched).toBe(1);
      expect(result.stats.strategy).toEqual(expect.objectContaining({ "exact-id": 1 }));
    });
  });

  describe("tool part matching by callID", () => {
    it("replaces optimistic tool part with canonical by callID", () => {
      const scenario = createCompletedToolScenario();
      const result = reconcileParts(scenario.canonical, scenario.optimistic);

      expect(result.toRemove).toEqual(expect.arrayContaining(scenario.expectedRemoved));
      expect(result.toUpsert).toHaveLength(scenario.expectedRemaining.length);
      expect(result.stats.matched).toBe(scenario.expectedMatches.length);
    });

    it("does not match tool parts with different callIDs", () => {
      const sessionId = "session-1";
      const messageId = "message-1";

      const optimistic = [
        createOptimisticToolPart(messageId, sessionId, "read", "call-1", "running"),
      ];
      const canonical = [
        createCanonicalToolPart(messageId, sessionId, "write", "call-2", "can-1", "completed"),
      ];

      const result = reconcileParts(canonical, optimistic);

      // No match - different callIDs
      expect(result.toRemove).toHaveLength(0);
      expect(result.toUpsert).toHaveLength(1);
      expect(result.stats.matched).toBe(0);
      expect(result.stats.unmatched).toBe(1);
    });
  });

  describe("text part matching by message+type", () => {
    it("replaces optimistic text part with canonical by message+type", () => {
      const scenario = createStreamingTextScenario();
      const result = reconcileParts(scenario.canonical, scenario.optimistic);

      expect(result.toRemove).toEqual(expect.arrayContaining(scenario.expectedRemoved));
      expect(result.toUpsert).toHaveLength(scenario.expectedRemaining.length);
      expect(result.stats.matched).toBe(scenario.expectedMatches.length);
    });

    it("only matches one text part per message", () => {
      const sessionId = "session-1";
      const messageId = "message-1";

      const optimistic = [
        createOptimisticTextPart(messageId, sessionId, "Text 1", { id: "opt-1" }),
        createOptimisticTextPart(messageId, sessionId, "Text 2", { id: "opt-2" }),
      ];
      const canonical = [createCanonicalTextPart(messageId, sessionId, "Final text", "can-1")];

      const result = reconcileParts(canonical, optimistic);

      // Should only match one
      expect(result.toRemove.length).toBeLessThanOrEqual(1);
      expect(result.stats.matched).toBe(1);
    });
  });

  describe("reasoning part matching", () => {
    it("replaces optimistic reasoning part with canonical by message+reasoningId", () => {
      const sessionId = "session-1";
      const messageId = "message-1";
      const reasoningId = "reasoning-1";

      const optimistic = [
        createOptimisticReasoningPart(messageId, sessionId, reasoningId, "Thinking..."),
      ];
      const canonical = [
        {
          id: "can-1",
          type: "reasoning",
          messageID: messageId,
          sessionID: sessionId,
          text: "Final reasoning",
          reasoningId,
          time: { start: Date.now(), end: Date.now() },
        } as Part,
      ];

      const result = reconcileParts(canonical, optimistic);

      expect(result.toRemove).toHaveLength(1);
      expect(result.stats.matched).toBe(1);
    });
  });

  describe("mixed scenarios", () => {
    it("handles mixed part types correctly", () => {
      const scenario = createMixedScenario();
      const result = reconcileParts(scenario.canonical, scenario.optimistic);

      // Should match text, tool1, and reasoning
      expect(result.stats.matched).toBe(scenario.expectedMatches.length);
      expect(result.toRemove).toEqual(expect.arrayContaining(scenario.expectedRemoved));
      // tool2 should not be removed (still streaming)
      expect(result.toRemove).not.toContain(scenario.unmatchedOptimistic[0]);
    });

    it("keeps unmatched canonical parts (new from SSE)", () => {
      const sessionId = "session-1";
      const messageId = "message-1";

      const optimistic: Part[] = [];
      const canonical = [createCanonicalTextPart(messageId, sessionId, "New text", "can-1")];

      const result = reconcileParts(canonical, optimistic);

      expect(result.toUpsert).toHaveLength(1);
      expect(result.toUpsert[0].id).toBe("can-1");
      expect(result.toRemove).toHaveLength(0);
    });

    it("returns unmatched optimistic (still streaming)", () => {
      const sessionId = "session-1";
      const messageId = "message-1";

      const optimistic = [createOptimisticTextPart(messageId, sessionId, "Streaming...")];
      const canonical: Part[] = [];

      const result = reconcileParts(canonical, optimistic);

      expect(result.toUpsert).toHaveLength(0);
      expect(result.toRemove).toHaveLength(0);
      expect(result.stats.unmatched).toBe(1);
    });
  });

  describe("stale optimistic entity detection", () => {
    it("identifies stale optimistic entities older than threshold", () => {
      const sessionId = "session-1";
      const messageId = "message-1";
      const oldTimestamp = Date.now() - CORRELATION_TIME_WINDOW_MS - 1000;

      const optimistic = [
        createOptimisticTextPart(messageId, sessionId, "Old text", {
          id: "old-1",
          timestamp: oldTimestamp,
        }),
      ];
      const canonical: Part[] = [];

      const result = reconcileParts(canonical, optimistic);

      expect(result.stats.stale).toBe(1);
    });
  });

  describe("statistics", () => {
    it("computes correct statistics for all scenarios", () => {
      const scenario = createMixedScenario();
      const result = reconcileParts(scenario.canonical, scenario.optimistic);

      expect(result.stats.totalCanonical).toBe(scenario.canonical.length);
      expect(result.stats.totalOptimistic).toBe(scenario.optimistic.length);
      expect(result.stats.matched).toBe(scenario.expectedMatches.length);
      expect(result.stats.unmatched).toBe(
        scenario.optimistic.length - scenario.expectedMatches.length
      );
    });
  });

  describe("empty inputs", () => {
    it("handles empty canonical and optimistic arrays", () => {
      const result = reconcileParts([], []);

      expect(result.toUpsert).toHaveLength(0);
      expect(result.toRemove).toHaveLength(0);
      expect(result.stats.totalCanonical).toBe(0);
      expect(result.stats.totalOptimistic).toBe(0);
    });

    it("handles empty optimistic array", () => {
      const canonical = [createCanonicalTextPart("m1", "s1", "Text", "c1")];
      const result = reconcileParts(canonical, []);

      expect(result.toUpsert).toHaveLength(1);
      expect(result.toRemove).toHaveLength(0);
    });

    it("handles empty canonical array", () => {
      const optimistic = [createOptimisticTextPart("m1", "s1", "Text")];
      const result = reconcileParts([], optimistic);

      expect(result.toUpsert).toHaveLength(0);
      expect(result.toRemove).toHaveLength(0);
    });
  });
});

describe("reconcileMessages", () => {
  describe("exact ID matching", () => {
    it("replaces optimistic message with canonical by exact ID", () => {
      const sessionId = "session-1";
      const sharedId = "shared-msg-id";

      const optimistic = [createOptimisticMessage(sessionId, "user", undefined, { id: sharedId })];
      const canonical = [createCanonicalMessage(sessionId, "user", sharedId, undefined)];

      const result = reconcileMessages(canonical, optimistic);

      expect(result.toRemove).toContain(sharedId);
      expect(result.toUpsert).toHaveLength(1);
      expect(result.stats.matched).toBe(1);
      expect(result.stats.strategy).toEqual(expect.objectContaining({ "exact-id": 1 }));
    });
  });

  describe("correlation matching", () => {
    it("replaces optimistic message with canonical by correlation", () => {
      const scenario = createMessageReconciliationScenario();
      const result = reconcileMessages(scenario.canonical, scenario.optimistic);

      expect(result.toRemove).toEqual(expect.arrayContaining(scenario.expectedRemoved));
      expect(result.toUpsert).toHaveLength(scenario.expectedRemaining.length);
      expect(result.stats.matched).toBe(scenario.expectedMatches.length);
    });

    it("matches by role and parent within time window", () => {
      const sessionId = "session-1";
      const parentId = "parent-1";
      const now = Date.now();

      const optimistic = [
        createOptimisticMessage(sessionId, "assistant", parentId, {
          id: "opt-1",
          timestamp: now - 1000, // 1 second ago
        }),
      ];
      const canonical = [
        createCanonicalMessage(sessionId, "assistant", "can-1", parentId, {
          time: { created: now },
        }),
      ];

      const result = reconcileMessages(canonical, optimistic);

      expect(result.toRemove).toContain("opt-1");
      expect(result.stats.matched).toBe(1);
    });

    it("does not match messages outside time window", () => {
      const sessionId = "session-1";
      const parentId = "parent-1";
      const now = Date.now();
      const tooOld = now - CORRELATION_TIME_WINDOW_MS - 1000;

      const optimistic = [
        createOptimisticMessage(sessionId, "assistant", parentId, {
          id: "opt-1",
          timestamp: tooOld,
        }),
      ];
      const canonical = [
        createCanonicalMessage(sessionId, "assistant", "can-1", parentId, {
          time: { created: now },
        }),
      ];

      const result = reconcileMessages(canonical, optimistic);

      expect(result.toRemove).not.toContain("opt-1");
      expect(result.stats.matched).toBe(0);
    });
  });

  describe("statistics", () => {
    it("computes correct statistics", () => {
      const scenario = createMessageReconciliationScenario();
      const result = reconcileMessages(scenario.canonical, scenario.optimistic);

      expect(result.stats.totalCanonical).toBe(scenario.canonical.length);
      expect(result.stats.totalOptimistic).toBe(scenario.optimistic.length);
      expect(result.stats.matched).toBe(scenario.expectedMatches.length);
    });
  });
});

describe("findOrphanedOptimisticEntities", () => {
  it("finds entities older than maxAgeMs", () => {
    const scenario = createStaleOptimisticScenario();
    const orphanedIds = findOrphanedOptimisticEntities(
      scenario.messages,
      CORRELATION_TIME_WINDOW_MS
    );

    expect(orphanedIds).toEqual(expect.arrayContaining(scenario.staleIds));
    for (const validId of scenario.validIds) {
      expect(orphanedIds).not.toContain(validId);
    }
  });

  it("returns empty array for non-optimistic entities", () => {
    const entities = [
      { id: "1" },
      { id: "2", metadata: undefined },
      { id: "3", metadata: { optimistic: false } },
    ];

    const orphaned = findOrphanedOptimisticEntities(entities, 1000);

    expect(orphaned).toHaveLength(0);
  });

  it("uses default maxAgeMs when not specified", () => {
    const oldTimestamp = Date.now() - CORRELATION_TIME_WINDOW_MS - 1000;
    const entities = [
      {
        id: "old-1",
        metadata: {
          optimistic: true,
          timestamp: oldTimestamp,
        },
      },
    ];

    const orphaned = findOrphanedOptimisticEntities(entities);

    expect(orphaned).toContain("old-1");
  });
});

describe("clearOptimisticMetadata", () => {
  it("removes optimistic metadata from entity", () => {
    const entity = {
      id: "test-1",
      data: "value",
      metadata: {
        optimistic: true,
        optimisticSource: "useChat",
        correlationKey: "key",
        timestamp: Date.now(),
      },
    };

    const cleaned = clearOptimisticMetadata(entity);

    expect(cleaned.metadata).toBeUndefined();
    expect(cleaned.id).toBe("test-1");
    expect(cleaned.data).toBe("value");
  });

  it("does not modify entity without metadata", () => {
    const entity = { id: "test-1", data: "value", metadata: undefined };

    const cleaned = clearOptimisticMetadata(entity);

    expect(cleaned).toEqual(entity);
  });

  it("does not modify non-optimistic metadata", () => {
    const entity = {
      id: "test-1",
      metadata: { someOtherKey: "value" },
    };

    const cleaned = clearOptimisticMetadata(entity);

    expect(cleaned.metadata).toEqual({ someOtherKey: "value" });
  });
});

// Helper function for reasoning part creation (if not in fixtures)
function createOptimisticReasoningPart(
  messageId: string,
  sessionId: string,
  reasoningId: string,
  text: string,
  overrides?: Partial<Part> & { timestamp?: number }
): Part {
  const id = overrides?.id ?? `${reasoningId}-reasoning-opt`;
  const timestamp = overrides?.timestamp ?? Date.now();

  return {
    id,
    type: "reasoning",
    messageID: messageId,
    sessionID: sessionId,
    text,
    reasoningId,
    time: { start: timestamp, end: timestamp },
    ...overrides,
    metadata: {
      optimistic: true,
      optimisticSource: "useChat",
      correlationKey: `part:${messageId}:reasoning:${reasoningId}`,
      timestamp,
    },
  };
}
