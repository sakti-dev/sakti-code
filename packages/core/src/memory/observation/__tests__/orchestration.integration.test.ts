/**
 * Tests for Observational Memory Orchestration - TDD
 *
 * Tests verify:
 * - getOrCreateObservationalMemory: Creates or retrieves records
 * - isAsyncObservationEnabled: Feature flag checking
 * - shouldTriggerAsyncObservation: Threshold checking
 * - filterAlreadyObservedMessages: Filtering observed messages
 * - processInputStep: Full orchestration flow
 * - calculateObservationThresholds: Token calculations
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservationalMemory } from "@/server-bridge";

describe("Observational Memory Orchestration", () => {
  let storage: import("@/memory/observation/storage").ObservationalMemoryStorage;

  beforeEach(async () => {
    const { ObservationalMemoryStorage } = await import("@/memory/observation/storage");
    storage = new ObservationalMemoryStorage();

    // Clean up observational memory from previous test runs
    const { getDb } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    await db.run(sql`DELETE FROM observational_memory`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("getOrCreateObservationalMemory", () => {
    it("should create new record when none exists", async () => {
      const { getOrCreateObservationalMemory } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();

      const record = await getOrCreateObservationalMemory({
        threadId,
        scope: "thread",
      });

      expect(record).toBeDefined();
      expect(record.thread_id).toBe(threadId);
      expect(record.scope).toBe("thread");
    });

    it("should return existing record when one exists", async () => {
      const { getOrCreateObservationalMemory } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();

      // Create first
      const record1 = await getOrCreateObservationalMemory({
        threadId,
        scope: "thread",
      });

      // Get again
      const record2 = await getOrCreateObservationalMemory({
        threadId,
        scope: "thread",
      });

      expect(record1.id).toBe(record2.id);
    });

    it("should create record with resource scope", async () => {
      const { getOrCreateObservationalMemory } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();
      const resourceId = "resource-1";

      const record = await getOrCreateObservationalMemory({
        threadId,
        resourceId,
        scope: "resource",
      });

      expect(record).toBeDefined();
      expect(record.resource_id).toBe(resourceId);
      expect(record.scope).toBe("resource");
    });
  });

  describe("isAsyncObservationEnabled", () => {
    it("should return true by default", async () => {
      const { isAsyncObservationEnabled } = await import("@/memory/observation/orchestration");
      expect(isAsyncObservationEnabled()).toBe(true);
    });

    it("should return false when DISABLE_ASYNC_OBSERVATION is true", async () => {
      const { isAsyncObservationEnabled } = await import("@/memory/observation/orchestration");
      const originalValue = process.env.DISABLE_ASYNC_OBSERVATION;
      process.env.DISABLE_ASYNC_OBSERVATION = "true";

      const result = isAsyncObservationEnabled();

      process.env.DISABLE_ASYNC_OBSERVATION = originalValue;
      expect(result).toBe(false);
    });
  });

  describe("shouldTriggerAsyncObservation", () => {
    it("should return false when above threshold", async () => {
      const { shouldTriggerAsyncObservation } = await import("@/memory/observation/orchestration");
      const result = shouldTriggerAsyncObservation(35000, 30000, 6000, null);
      expect(result).toBe(false);
    });

    it("should return true when bufferTokens interval reached", async () => {
      const { shouldTriggerAsyncObservation } = await import("@/memory/observation/orchestration");
      const result = shouldTriggerAsyncObservation(6000, 30000, 6000, null);
      expect(result).toBe(true);
    });

    it("should return true when tokens since last buffer exceeds interval", async () => {
      const { shouldTriggerAsyncObservation } = await import("@/memory/observation/orchestration");
      // 12000 tokens total, last buffered at 5000, buffer interval 6000
      const result = shouldTriggerAsyncObservation(12000, 30000, 6000, 5000);
      expect(result).toBe(true);
    });

    it("should return false when below buffer interval", async () => {
      const { shouldTriggerAsyncObservation } = await import("@/memory/observation/orchestration");
      // 8000 tokens total, last buffered at 3000, buffer interval 6000
      const result = shouldTriggerAsyncObservation(8000, 30000, 6000, 3000);
      expect(result).toBe(false);
    });
  });

  describe("filterAlreadyObservedMessages", () => {
    it("should filter out observed messages", async () => {
      const { filterAlreadyObservedMessages } = await import("@/memory/observation/orchestration");
      const record = {
        id: "record-1",
        observed_message_ids: ["msg-1", "msg-2"],
      } as unknown as ObservationalMemory;

      const messages = [
        { id: "msg-1", role: "user" as const, content: "Hello" },
        { id: "msg-2", role: "assistant" as const, content: "Hi" },
        { id: "msg-3", role: "user" as const, content: "New" },
      ];

      const result = filterAlreadyObservedMessages(messages, record);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("msg-3");
    });

    it("should return all messages when none observed", async () => {
      const { filterAlreadyObservedMessages } = await import("@/memory/observation/orchestration");
      const record = {
        id: "record-1",
        observed_message_ids: [],
      } as unknown as ObservationalMemory;

      const messages = [
        { id: "msg-1", role: "user" as const, content: "Hello" },
        { id: "msg-2", role: "assistant" as const, content: "Hi" },
      ];

      const result = filterAlreadyObservedMessages(messages, record);

      expect(result).toHaveLength(2);
    });

    it("should handle null observed_message_ids", async () => {
      const { filterAlreadyObservedMessages } = await import("@/memory/observation/orchestration");
      const record = {
        id: "record-1",
        observed_message_ids: null,
      } as unknown as ObservationalMemory;

      const messages = [{ id: "msg-1", role: "user" as const, content: "Hello" }];

      const result = filterAlreadyObservedMessages(messages, record);

      expect(result).toHaveLength(1);
    });
  });

  describe("processInputStep", () => {
    it("should create new record for new thread", async () => {
      const { processInputStep } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();
      const messages = [{ id: "msg-1", role: "user" as const, content: "Hello" }];
      const tokenCounter = { countMessages: () => 100, countString: () => 100 };
      const observerAgent = async () => "Observation";

      const result = await processInputStep({
        messages,
        context: { threadId, scope: "thread" },
        stepNumber: 0,
        tokenCounter,
        observerAgent,
      });

      expect(result.record).toBeDefined();
      expect(result.record.thread_id).toBe(threadId);
      expect(result.observationsInjected).toBe(false);
    });

    it("should filter already observed messages", async () => {
      const { processInputStep } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();

      // Create record with observed messages
      await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: Date.now(),
      });

      // Manually add observed message IDs
      const record = await storage.getObservationalMemory("thread", undefined, threadId);
      await storage.updateObservationalMemory(record!.id, {
        observedMessageIds: ["msg-1"],
      });

      const messages = [
        { id: "msg-1", role: "user" as const, content: "Hello" },
        { id: "msg-2", role: "user" as const, content: "World" },
      ];
      const tokenCounter = { countMessages: () => 100, countString: () => 100 };
      const observerAgent = async () => "Observation";

      const result = await processInputStep({
        messages,
        context: { threadId, scope: "thread" },
        stepNumber: 0,
        tokenCounter,
        observerAgent,
      });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe("msg-2");
    });

    it("should trigger async observation at bufferTokens interval", async () => {
      const { processInputStep } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();
      const messages = [{ id: "msg-1", role: "user" as const, content: "A".repeat(1000) }];

      // Token counter returns 6000 to trigger buffer
      const tokenCounter = {
        countMessages: () => 6000,
        countString: () => 6000,
      };
      const observerAgent = vi.fn().mockResolvedValue("Observation");

      await processInputStep({
        messages,
        context: { threadId, scope: "thread" },
        stepNumber: 0,
        tokenCounter,
        observerAgent,
      });

      // Wait for async operation
      await new Promise(r => setTimeout(r, 100));

      // Should have set buffering flag
      const record = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(record?.is_buffering_observation).toBe(1);
    });

    it("should not observe in readOnly mode", async () => {
      const { processInputStep } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();
      const messages = [{ id: "msg-1", role: "user" as const, content: "Hello" }];
      const tokenCounter = { countMessages: () => 100, countString: () => 100 };
      const observerAgent = vi.fn().mockResolvedValue("Observation");

      const result = await processInputStep({
        messages,
        context: { threadId, scope: "thread" },
        stepNumber: 0,
        readOnly: true,
        tokenCounter,
        observerAgent,
      });

      expect(result.didObserve).toBe(false);
      expect(observerAgent).not.toHaveBeenCalled();
    });

    it("should activate buffered observations on step 0 when pending tokens exceed activation threshold", async () => {
      const { processInputStep } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();

      const created = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: Date.now(),
        config: {
          observationThreshold: 1000,
          reflectionThreshold: 2000,
          bufferTokens: 200,
          bufferActivation: 0.8,
          blockAfter: 7200,
          scope: "thread",
          lastMessages: 10,
          maxRecentObservations: 50,
          maxRecentHours: 24,
        },
      });

      await storage.updateBufferedObservations(created.id, [
        {
          content: "Buffered observation from async pass",
          messageIds: ["msg-1"],
          messageTokens: 900,
          createdAt: new Date(),
        },
      ]);

      const messages = [{ id: "msg-1", role: "user" as const, content: "A".repeat(120) }];
      const tokenCounter = {
        countMessages: () => 900,
        countString: () => 900,
      };
      const observerAgent = vi.fn().mockResolvedValue("Observation");

      const result = await processInputStep({
        messages,
        context: { threadId, scope: "thread" },
        stepNumber: 0,
        tokenCounter,
        observerAgent,
      });

      expect(result.record.active_observations ?? "").toContain(
        "Buffered observation from async pass"
      );
      expect(result.record.buffered_observation_chunks ?? []).toHaveLength(0);
    });

    it("should run synchronous observation at step 0 when threshold is exceeded", async () => {
      const { processInputStep } = await import("@/memory/observation/orchestration");
      const threadId = uuidv7();
      const messages = [{ id: "msg-sync-1", role: "user" as const, content: "A".repeat(1000) }];
      const tokenCounter = {
        countMessages: () => 2000,
        countString: () => 2000,
      };
      const observerAgent = vi.fn().mockResolvedValue("Synchronous observation content");

      const result = await processInputStep({
        messages,
        context: { threadId, scope: "thread" },
        stepNumber: 0,
        tokenCounter,
        observerAgent,
        config: {
          observationThreshold: 1000,
          reflectionThreshold: 5000,
          bufferTokens: 200,
          bufferActivation: 0.8,
          blockAfter: 7200,
          scope: "thread",
          lastMessages: 10,
          maxRecentObservations: 50,
          maxRecentHours: 24,
        },
      });

      expect(observerAgent).toHaveBeenCalledTimes(1);
      expect(result.didObserve).toBe(true);
      expect(result.record.active_observations ?? "").toContain("Synchronous observation content");
      expect(result.record.observed_message_ids ?? []).toContain("msg-sync-1");
    });
  });

  describe("calculateObservationThresholds", () => {
    it("should calculate total pending tokens correctly", async () => {
      const { calculateObservationThresholds } = await import("@/memory/observation/storage");
      const messages = [
        { id: "msg-1", role: "user" as const, content: "Hello" },
        { id: "msg-2", role: "assistant" as const, content: "Hi" },
      ];
      const tokenCounter = {
        countMessages: () => 1000,
        countString: () => 500,
      };

      const record = {
        id: "record-1",
        config: {
          observationThreshold: 30000,
          reflectionThreshold: 40000,
          bufferTokens: 6000,
          bufferActivation: 0.8,
          blockAfter: 7200,
          scope: "thread" as const,
          lastMessages: 10,
        },
      } as ObservationalMemory;

      const result = calculateObservationThresholds(
        messages,
        500, // pendingTokens
        300, // otherThreadTokens
        200, // currentObservationTokens
        record,
        tokenCounter
      );

      // Total = 1000 (all messages) + 300 (other threads) + 500 (pending) + 200 (observations) = 2000
      expect(result.totalPendingTokens).toBe(2000);
      // Threshold = 30000 - 200 = 29800
      expect(result.threshold).toBe(29800);
    });

    it("should use defaults when config is missing", async () => {
      const { calculateObservationThresholds } = await import("@/memory/observation/storage");
      const messages = [{ id: "msg-1", role: "user" as const, content: "Hello" }];
      const tokenCounter = {
        countMessages: () => 100,
        countString: () => 100,
      };

      const record = {
        id: "record-1",
        config: null,
      } as ObservationalMemory;

      const result = calculateObservationThresholds(messages, 0, 0, 0, record, tokenCounter);

      // Threshold should use default 30000
      expect(result.threshold).toBe(30000);
    });
  });
});
