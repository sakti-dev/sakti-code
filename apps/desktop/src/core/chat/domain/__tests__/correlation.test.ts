/**
 * Correlation Key System Tests
 *
 * Tests for matching optimistic entities with canonical SSE events.
 */

import type {
  MessageWithOptimisticMetadata,
  PartWithOptimisticMetadata,
} from "@/core/chat/domain/correlation";
import {
  CORRELATION_TIME_WINDOW_MS,
  createOptimisticMetadata,
  filterStaleOptimisticEntities,
  findMatchingMessage,
  findMatchingPart,
  generateMessageCorrelationKey,
  generatePartCorrelationKey,
  getOptimisticAge,
  isOptimisticEntity,
  matchMessageByCorrelation,
  matchMessageByExactId,
  matchPartByExactId,
  matchReasoningPart,
  matchTextPartByMessage,
  matchToolPartByCallId,
} from "@/core/chat/domain/correlation";
import { describe, expect, it } from "vitest";

describe("Correlation Key System", () => {
  describe("generateMessageCorrelationKey", () => {
    it("generates consistent keys for same inputs", () => {
      const key1 = generateMessageCorrelationKey({
        role: "assistant",
        parentID: "parent-123",
        createdAt: 1000,
      });
      const key2 = generateMessageCorrelationKey({
        role: "assistant",
        parentID: "parent-123",
        createdAt: 1000,
      });
      expect(key1).toBe(key2);
    });

    it("includes role, parent, and timestamp in key", () => {
      const key = generateMessageCorrelationKey({
        role: "user",
        parentID: undefined,
        createdAt: 1234567890,
      });
      expect(key).toContain("user");
      expect(key).toContain("no-parent");
      expect(key).toContain("1234567890");
    });
  });

  describe("generatePartCorrelationKey", () => {
    it("generates consistent keys for same inputs", () => {
      const key1 = generatePartCorrelationKey({
        messageID: "msg-123",
        partType: "tool",
        callID: "call-456",
      });
      const key2 = generatePartCorrelationKey({
        messageID: "msg-123",
        partType: "tool",
        callID: "call-456",
      });
      expect(key1).toBe(key2);
    });

    it("uses callID when available", () => {
      const key = generatePartCorrelationKey({
        messageID: "msg-123",
        partType: "tool",
        callID: "call-456",
      });
      expect(key).toContain("call-456");
    });

    it("uses reasoningId when callID not available", () => {
      const key = generatePartCorrelationKey({
        messageID: "msg-123",
        partType: "reasoning",
        reasoningId: "reason-789",
      });
      expect(key).toContain("reason-789");
    });

    it("uses 'default' when neither callID nor reasoningId available", () => {
      const key = generatePartCorrelationKey({
        messageID: "msg-123",
        partType: "text",
      });
      expect(key).toContain("default");
    });
  });

  describe("matchMessageByExactId", () => {
    it("returns true when IDs match", () => {
      const optimistic = {
        id: "msg-123",
        role: "user",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as MessageWithOptimisticMetadata;

      expect(matchMessageByExactId(optimistic, "msg-123")).toBe(true);
    });

    it("returns false when IDs don't match", () => {
      const optimistic = {
        id: "msg-123",
        role: "user",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as MessageWithOptimisticMetadata;

      expect(matchMessageByExactId(optimistic, "msg-456")).toBe(false);
    });
  });

  describe("matchMessageByCorrelation", () => {
    const now = Date.now();

    it("matches by parentID, role, and time window", () => {
      const optimistic = {
        id: "optimistic-123",
        role: "assistant",
        parentID: "parent-123",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as MessageWithOptimisticMetadata;
      // Override timestamp to be recent
      optimistic.metadata!.timestamp = now;

      expect(
        matchMessageByCorrelation(optimistic, {
          role: "assistant",
          parentID: "parent-123",
          createdAt: now + 1000,
        })
      ).toBe(true);
    });

    it("returns false if not optimistic", () => {
      const nonOptimistic = {
        id: "msg-123",
        role: "assistant",
        parentID: "parent-123",
        // No metadata
      } as MessageWithOptimisticMetadata;

      expect(
        matchMessageByCorrelation(nonOptimistic, {
          role: "assistant",
          parentID: "parent-123",
          createdAt: now,
        })
      ).toBe(false);
    });

    it("returns false if role doesn't match", () => {
      const optimistic = {
        id: "optimistic-123",
        role: "user",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as MessageWithOptimisticMetadata;
      optimistic.metadata!.timestamp = now;

      expect(
        matchMessageByCorrelation(optimistic, {
          role: "assistant",
          parentID: undefined,
          createdAt: now + 1000,
        })
      ).toBe(false);
    });

    it("returns false if outside time window", () => {
      const optimistic = {
        id: "optimistic-123",
        role: "assistant",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as MessageWithOptimisticMetadata;
      optimistic.metadata!.timestamp = now - CORRELATION_TIME_WINDOW_MS - 1000;

      expect(
        matchMessageByCorrelation(optimistic, {
          role: "assistant",
          parentID: undefined,
          createdAt: now,
        })
      ).toBe(false);
    });

    it("returns false if parentID doesn't match", () => {
      const optimistic = {
        id: "optimistic-123",
        role: "assistant",
        parentID: "parent-123",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as MessageWithOptimisticMetadata;
      optimistic.metadata!.timestamp = now;

      expect(
        matchMessageByCorrelation(optimistic, {
          role: "assistant",
          parentID: "different-parent",
          createdAt: now + 1000,
        })
      ).toBe(false);
    });
  });

  describe("findMatchingMessage", () => {
    const now = Date.now();

    it("finds exact ID match first", () => {
      const messages: MessageWithOptimisticMetadata[] = [
        {
          id: "msg-1",
          role: "user",
          metadata: createOptimisticMetadata("useChat", "key-1"),
        },
        {
          id: "msg-2",
          role: "assistant",
          parentID: "parent-1",
          metadata: createOptimisticMetadata("useChat", "key-2"),
        },
      ] as MessageWithOptimisticMetadata[];
      messages[1].metadata!.timestamp = now;

      const match = findMatchingMessage(messages, {
        id: "msg-2",
        role: "assistant",
        parentID: "parent-1",
        createdAt: now + 1000,
      });

      expect(match).toBeDefined();
      expect(match?.entity.id).toBe("msg-2");
      expect(match?.confidence).toBe("exact");
      expect(match?.strategy).toBe("exact-id");
    });

    it("falls back to correlation match", () => {
      const messages: MessageWithOptimisticMetadata[] = [
        {
          id: "optimistic-1",
          role: "assistant",
          parentID: "parent-1",
          metadata: createOptimisticMetadata("useChat", "key-1"),
        },
      ] as MessageWithOptimisticMetadata[];
      messages[0].metadata!.timestamp = now;

      const match = findMatchingMessage(messages, {
        id: "canonical-1", // Different ID
        role: "assistant",
        parentID: "parent-1",
        createdAt: now + 1000,
      });

      expect(match).toBeDefined();
      expect(match?.entity.id).toBe("optimistic-1");
      expect(match?.confidence).toBe("correlation");
      expect(match?.strategy).toBe("parent-window-role");
    });

    it("returns undefined when no match", () => {
      const messages: MessageWithOptimisticMetadata[] = [
        {
          id: "msg-1",
          role: "user",
          metadata: createOptimisticMetadata("useChat", "key-1"),
        },
      ] as MessageWithOptimisticMetadata[];

      const match = findMatchingMessage(messages, {
        id: "different-id",
        role: "assistant",
        parentID: "different-parent",
        createdAt: now,
      });

      expect(match).toBeUndefined();
    });
  });

  describe("matchPartByExactId", () => {
    it("returns true when IDs match", () => {
      const optimistic = {
        id: "part-123",
        type: "text",
        messageID: "msg-1",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as PartWithOptimisticMetadata;

      expect(matchPartByExactId(optimistic, "part-123")).toBe(true);
    });

    it("returns false when IDs don't match", () => {
      const optimistic = {
        id: "part-123",
        type: "text",
        messageID: "msg-1",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as PartWithOptimisticMetadata;

      expect(matchPartByExactId(optimistic, "part-456")).toBe(false);
    });
  });

  describe("matchToolPartByCallId", () => {
    it("matches tool parts by callID", () => {
      const optimistic = {
        id: "part-123",
        type: "tool",
        messageID: "msg-1",
        callID: "call-456",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchToolPartByCallId(optimistic, "msg-1", "call-456")).toBe(true);
    });

    it("matches tool-call parts by callID", () => {
      const optimistic = {
        id: "part-123",
        type: "tool-call",
        messageID: "msg-1",
        callID: "call-456",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchToolPartByCallId(optimistic, "msg-1", "call-456")).toBe(true);
    });

    it("returns false if messageID doesn't match", () => {
      const optimistic = {
        id: "part-123",
        type: "tool",
        messageID: "msg-1",
        callID: "call-456",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchToolPartByCallId(optimistic, "msg-different", "call-456")).toBe(false);
    });

    it("returns false if callID doesn't match", () => {
      const optimistic = {
        id: "part-123",
        type: "tool",
        messageID: "msg-1",
        callID: "call-456",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchToolPartByCallId(optimistic, "msg-1", "call-different")).toBe(false);
    });

    it("returns false if not optimistic", () => {
      const nonOptimistic = {
        id: "part-123",
        type: "tool",
        messageID: "msg-1",
        callID: "call-456",
      } as PartWithOptimisticMetadata;

      expect(matchToolPartByCallId(nonOptimistic, "msg-1", "call-456")).toBe(false);
    });
  });

  describe("matchTextPartByMessage", () => {
    it("matches text parts by messageID", () => {
      const optimistic = {
        id: "part-123",
        type: "text",
        messageID: "msg-1",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchTextPartByMessage(optimistic, "msg-1")).toBe(true);
    });

    it("returns false if type is not text", () => {
      const optimistic = {
        id: "part-123",
        type: "tool",
        messageID: "msg-1",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchTextPartByMessage(optimistic, "msg-1")).toBe(false);
    });

    it("returns false if messageID doesn't match", () => {
      const optimistic = {
        id: "part-123",
        type: "text",
        messageID: "msg-1",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchTextPartByMessage(optimistic, "msg-different")).toBe(false);
    });
  });

  describe("matchReasoningPart", () => {
    it("matches reasoning parts by messageID", () => {
      const optimistic = {
        id: "part-123",
        type: "reasoning",
        messageID: "msg-1",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchReasoningPart(optimistic, "msg-1")).toBe(true);
    });

    it("matches reasoning parts by messageID and reasoningId", () => {
      const optimistic = {
        id: "part-123",
        type: "reasoning",
        messageID: "msg-1",
        reasoningId: "reason-456",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchReasoningPart(optimistic, "msg-1", "reason-456")).toBe(true);
    });

    it("returns false if reasoningId doesn't match", () => {
      const optimistic = {
        id: "part-123",
        type: "reasoning",
        messageID: "msg-1",
        reasoningId: "reason-456",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchReasoningPart(optimistic, "msg-1", "reason-different")).toBe(false);
    });

    it("returns false if type is not reasoning", () => {
      const optimistic = {
        id: "part-123",
        type: "text",
        messageID: "msg-1",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      } as unknown as PartWithOptimisticMetadata;

      expect(matchReasoningPart(optimistic, "msg-1")).toBe(false);
    });
  });

  describe("findMatchingPart", () => {
    it("finds exact ID match first", () => {
      const parts: PartWithOptimisticMetadata[] = [
        {
          id: "part-1",
          type: "text",
          messageID: "msg-1",
          metadata: createOptimisticMetadata("useChat", "key-1"),
        },
        {
          id: "part-2",
          type: "tool",
          messageID: "msg-1",
          callID: "call-1",
          metadata: createOptimisticMetadata("useChat", "key-2"),
        },
      ] as unknown as PartWithOptimisticMetadata[];

      const match = findMatchingPart(parts, {
        id: "part-2",
        type: "tool",
        messageID: "msg-1",
        callID: "call-1",
      });

      expect(match).toBeDefined();
      expect(match?.entity.id).toBe("part-2");
      expect(match?.confidence).toBe("exact");
    });

    it("finds tool part by callID", () => {
      const parts: PartWithOptimisticMetadata[] = [
        {
          id: "optimistic-part",
          type: "tool",
          messageID: "msg-1",
          callID: "call-1",
          metadata: createOptimisticMetadata("useChat", "key-1"),
        },
      ] as unknown as PartWithOptimisticMetadata[];

      const match = findMatchingPart(parts, {
        id: "canonical-part", // Different ID
        type: "tool",
        messageID: "msg-1",
        callID: "call-1",
      });

      expect(match).toBeDefined();
      expect(match?.entity.id).toBe("optimistic-part");
      expect(match?.confidence).toBe("correlation");
      expect(match?.strategy).toBe("message-callid");
    });

    it("finds text part by messageID", () => {
      const parts: PartWithOptimisticMetadata[] = [
        {
          id: "optimistic-part",
          type: "text",
          messageID: "msg-1",
          metadata: createOptimisticMetadata("useChat", "key-1"),
        },
      ] as unknown as PartWithOptimisticMetadata[];

      const match = findMatchingPart(parts, {
        id: "canonical-part", // Different ID
        type: "text",
        messageID: "msg-1",
      });

      expect(match).toBeDefined();
      expect(match?.entity.id).toBe("optimistic-part");
      expect(match?.confidence).toBe("correlation");
      expect(match?.strategy).toBe("message-type");
    });

    it("returns undefined when no match", () => {
      const parts: PartWithOptimisticMetadata[] = [
        {
          id: "part-1",
          type: "text",
          messageID: "msg-1",
          metadata: createOptimisticMetadata("useChat", "key-1"),
        },
      ] as unknown as PartWithOptimisticMetadata[];

      const match = findMatchingPart(parts, {
        id: "different-id",
        type: "tool",
        messageID: "msg-different",
        callID: "call-different",
      });

      expect(match).toBeUndefined();
    });
  });

  describe("isOptimisticEntity", () => {
    it("returns true for optimistic entity", () => {
      const entity = {
        id: "msg-1",
        metadata: createOptimisticMetadata("useChat", "key-1"),
      };

      expect(isOptimisticEntity(entity)).toBe(true);
    });

    it("returns false for non-optimistic entity", () => {
      const entity = { id: "msg-1", metadata: { other: "data" } };

      expect(
        isOptimisticEntity(entity as unknown as Parameters<typeof isOptimisticEntity>[0])
      ).toBe(false);
    });

    it("returns false when no metadata", () => {
      const entity = { id: "msg-1" };

      expect(
        isOptimisticEntity(entity as unknown as Parameters<typeof isOptimisticEntity>[0])
      ).toBe(false);
    });
  });

  describe("getOptimisticAge", () => {
    it("returns age in milliseconds for optimistic entity", () => {
      const now = Date.now();
      const entity = {
        id: "msg-1",
        metadata: {
          optimistic: true as const,
          optimisticSource: "useChat" as const,
          correlationKey: "key-1",
          timestamp: now - 5000, // Created 5 seconds ago
        },
      };

      const age = getOptimisticAge(entity);
      expect(age).toBeGreaterThanOrEqual(5000);
      expect(age).toBeLessThan(5100);
    });

    it("returns Infinity for non-optimistic entity", () => {
      const entity = { id: "msg-1" };

      expect(getOptimisticAge(entity as unknown as Parameters<typeof getOptimisticAge>[0])).toBe(
        Infinity
      );
    });
  });

  describe("filterStaleOptimisticEntities", () => {
    it("returns only stale optimistic entities", () => {
      const now = Date.now();
      const entities = [
        {
          id: "fresh",
          metadata: {
            optimistic: true as const,
            optimisticSource: "useChat" as const,
            correlationKey: "key-1",
            timestamp: now - 1000, // 1 second old
          },
        },
        {
          id: "stale",
          metadata: {
            optimistic: true as const,
            optimisticSource: "useChat" as const,
            correlationKey: "key-2",
            timestamp: now - CORRELATION_TIME_WINDOW_MS - 1000, // Older than window
          },
        },
        {
          id: "non-optimistic",
          // No metadata
        },
      ];

      const stale = filterStaleOptimisticEntities(entities, CORRELATION_TIME_WINDOW_MS);
      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe("stale");
    });

    it("uses default window when not specified", () => {
      const now = Date.now();
      const entities = [
        {
          id: "stale",
          metadata: {
            optimistic: true as const,
            optimisticSource: "useChat" as const,
            correlationKey: "key-1",
            timestamp: now - CORRELATION_TIME_WINDOW_MS - 1000,
          },
        },
      ];

      const stale = filterStaleOptimisticEntities(entities);
      expect(stale).toHaveLength(1);
    });
  });
});
