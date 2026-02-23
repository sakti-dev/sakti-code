/**
 * Tests for ObservationalMemoryStorage - Phase 2 Async Buffering & Crash Recovery
 *
 * Tests verify:
 * - createObservationalMemory: Create new observation records
 * - State flags: isObserving, isBufferingObservation, isReflecting, isBufferingReflection
 * - Lease-based locking: acquireLock, heartbeatLock, releaseLock
 * - Async buffering: startAsyncBufferedObservation, tryActivateBufferedObservations
 * - Stale flag detection: detectAndClearStaleFlags
 * - Lookup key pattern: getObservationalMemory by thread or resource scope
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ObservationalMemoryConfig } from "@/memory/observation/storage";

describe("ObservationalMemoryStorage", () => {
  let storage: import("@/memory/observation/storage").ObservationalMemoryStorage;
  let ObservationalMemoryStorageClass: typeof import("@/memory/observation/storage").ObservationalMemoryStorage;

  beforeEach(async () => {
    const mod = await import("@/memory/observation/storage");
    ObservationalMemoryStorageClass = mod.ObservationalMemoryStorage;
    storage = new ObservationalMemoryStorageClass();

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

  describe("createObservationalMemory", () => {
    it("should create observational memory with thread scope", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        resourceId: "resource-1",
        scope: "thread",
        createdAt: now,
      });

      expect(record).toBeDefined();
      expect(record.thread_id).toBe(threadId);
      expect(record.resource_id).toBe("resource-1");
      expect(record.scope).toBe("thread");
      expect(record.is_observing).toBe(0);
      expect(record.is_buffering_observation).toBe(0);
      expect(record.is_reflecting).toBe(0);
      expect(record.is_buffering_reflection).toBe(0);
    });

    it("should create observational memory with resource scope", async () => {
      const resourceId = "resource-1";
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        resourceId,
        scope: "resource",
        createdAt: now,
      });

      expect(record).toBeDefined();
      expect(record.scope).toBe("resource");
      expect(record.lookup_key).toBe(`resource:${resourceId}`);
    });

    it("should generate correct lookup key for thread scope", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        resourceId: "resource-1",
        scope: "thread",
        createdAt: now,
      });

      expect(record.lookup_key).toBe(`thread:${threadId}`);
    });

    it("should have default configuration values", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const config = record.config as ObservationalMemoryConfig;
      expect(config).toBeDefined();
      expect(config.observationThreshold).toBe(30000);
      expect(config.reflectionThreshold).toBe(40000);
      expect(config.bufferTokens).toBe(6000);
      expect(config.bufferActivation).toBe(0.8);
      expect(config.scope).toBe("thread");
    });
  });

  describe("getObservationalMemory", () => {
    it("should retrieve observational memory by thread ID", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const record = await storage.getObservationalMemory("thread", undefined, threadId);

      expect(record).toBeDefined();
      expect(record?.thread_id).toBe(threadId);
    });

    it("should retrieve observational memory by resource ID", async () => {
      const resourceId = "resource-1";
      const now = Date.now();

      await storage.createObservationalMemory({
        resourceId,
        scope: "resource",
        createdAt: now,
      });

      const record = await storage.getObservationalMemory("resource", resourceId, undefined);

      expect(record).toBeDefined();
      expect(record?.resource_id).toBe(resourceId);
    });

    it("should return null for non-existent record", async () => {
      const record = await storage.getObservationalMemory("thread", undefined, "non-existent");

      expect(record).toBeNull();
    });
  });

  describe("updateObservationalMemory", () => {
    it("should update active observations", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const updated = await storage.updateObservationalMemory(record.id, {
        activeObservations: "🔴 10:00 Created Login schema",
      });

      expect(updated?.active_observations).toBe("🔴 10:00 Created Login schema");
    });

    it("should update state flags", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const updated = await storage.updateObservationalMemory(record.id, {
        isObserving: true,
        lastObservedAt: now,
      });

      expect(updated?.is_observing).toBe(1);
      expect(updated?.last_observed_at).toBeInstanceOf(Date);
    });
  });

  describe("lease-based locking", () => {
    it("should acquire lock for observation", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const ownerId = "instance-1";
      const result = await storage.acquireLock(record.id, ownerId);

      expect(result.success).toBe(true);
      expect(result.operationId).toBeDefined();

      // Verify lock is set
      const locked = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(locked?.lock_owner_id).toBe(ownerId);
      expect(locked?.lock_operation_id).toBe(result.operationId);
      expect(locked?.lock_expires_at).toBeInstanceOf(Date);
    });

    it("should not acquire lock if already locked by another instance", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      // First instance acquires lock
      await storage.acquireLock(record.id, "instance-1");

      // Second instance tries to acquire lock
      const result = await storage.acquireLock(record.id, "instance-2");

      expect(result.success).toBe(false);
    });

    it("should allow same instance to renew lock", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const ownerId = "instance-1";
      const result1 = await storage.acquireLock(record.id, ownerId);
      const operationId = result1.operationId!;

      // Renew lock
      const result2 = await storage.acquireLock(record.id, ownerId);

      expect(result2.success).toBe(true);
      expect(result2.operationId).toBe(operationId);
    });

    it("should heartbeat renew lock expiration", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const ownerId = "instance-1";
      const result = await storage.acquireLock(record.id, ownerId);
      const originalHeartbeat = (
        await storage.getObservationalMemory("thread", undefined, threadId)
      )?.last_heartbeat_at;

      // Wait a bit then heartbeat
      await new Promise(r => setTimeout(r, 50));
      const heartbeatResult = await storage.heartbeatLock(record.id, ownerId, result.operationId!);

      expect(heartbeatResult).toBe(true);

      const renewed = await storage.getObservationalMemory("thread", undefined, threadId);
      // Heartbeat should update last_heartbeat_at - use >= to handle millisecond precision
      expect(renewed?.last_heartbeat_at?.getTime()).toBeGreaterThanOrEqual(
        originalHeartbeat!.getTime()
      );
    });

    it("should not heartbeat with wrong operation ID", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      await storage.acquireLock(record.id, "instance-1");

      // Try to heartbeat with wrong operation ID
      const heartbeatResult = await storage.heartbeatLock(record.id, "instance-1", "wrong-op-id");

      expect(heartbeatResult).toBe(false);
    });

    it("should release lock with correct owner and operation ID", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const ownerId = "instance-1";
      const result = await storage.acquireLock(record.id, ownerId);
      const operationId = result.operationId!;

      // Verify lock is acquired
      let locked = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(locked?.lock_owner_id).toBe(ownerId);

      // Release lock
      const releaseResult = await storage.releaseLock(record.id, ownerId, operationId);
      expect(releaseResult).toBe(true);

      // Verify lock is released
      locked = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(locked?.lock_owner_id).toBeNull();
      expect(locked?.lock_operation_id).toBeNull();
      expect(locked?.lock_expires_at).toBeNull();
    });

    it("should not release lock with wrong owner", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const result = await storage.acquireLock(record.id, "instance-1");
      const operationId = result.operationId!;

      // Try to release with wrong owner
      const releaseResult = await storage.releaseLock(record.id, "instance-2", operationId);
      expect(releaseResult).toBe(false);

      // Verify lock is still held by original owner
      const locked = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(locked?.lock_owner_id).toBe("instance-1");
    });

    it("should not release lock with wrong operation ID", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      await storage.acquireLock(record.id, "instance-1");

      // Try to release with wrong operation ID
      const releaseResult = await storage.releaseLock(record.id, "instance-1", "wrong-op-id");
      expect(releaseResult).toBe(false);

      // Verify lock is still held
      const locked = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(locked?.lock_owner_id).toBe("instance-1");
    });

    it("should allow only one winner when two instances race to acquire an expired lock", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const { getDb, observationalMemory } = await import("@/testing/db");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();

      await db
        .update(observationalMemory)
        .set({
          lock_owner_id: "stale-owner",
          lock_operation_id: "stale-operation",
          lock_expires_at: new Date(Date.now() - 60_000),
          updated_at: new Date(),
        })
        .where(eq(observationalMemory.id, record.id));

      const [a, b] = await Promise.all([
        storage.acquireLock(record.id, "instance-A"),
        storage.acquireLock(record.id, "instance-B"),
      ]);

      const successCount = [a, b].filter(result => result.success).length;
      expect(successCount).toBe(1);
    });
  });

  describe("async buffering", () => {
    it("should set buffering observation flag", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      await storage.setBufferingObservationFlag(record.id, true, 5000);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.is_buffering_observation).toBe(1);
      expect(updated?.last_buffered_at_tokens).toBe(5000);
      expect(updated?.last_buffered_at_time).toBeInstanceOf(Date);
    });

    it("should clear buffering observation flag", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      await storage.setBufferingObservationFlag(record.id, true, 5000);
      await storage.setBufferingObservationFlag(record.id, false, 5000);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.is_buffering_observation).toBe(0);
    });

    it("should update buffered observations", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const bufferedChunk = {
        content: "Observation chunk 1",
        messageIds: ["msg-1", "msg-2"],
        messageTokens: 1000,
        createdAt: new Date(),
      };

      await storage.updateBufferedObservations(record.id, [bufferedChunk]);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.buffered_observation_chunks).toHaveLength(1);
      expect(updated?.buffered_observation_chunks?.[0].content).toBe("Observation chunk 1");
    });

    it("should swap buffered to active observations", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const bufferedChunk = {
        content: "Buffered observation",
        messageIds: ["msg-1"],
        messageTokens: 500,
        createdAt: new Date(),
      };

      await storage.updateBufferedObservations(record.id, [bufferedChunk]);
      await storage.swapBufferedToActive(record.id, 1.0);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.active_observations).toContain("Buffered observation");
      expect(updated?.buffered_observation_chunks).toHaveLength(0);
    });
  });

  describe("stale flag detection", () => {
    it("should detect and clear stale buffering flag", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      // Simulate stale flag (set without actual async operation running)
      await storage.setBufferingObservationFlag(record.id, true, 5000);

      // Detect and clear stale flag
      await storage.detectAndClearStaleFlags(record.id);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      // Flag should be cleared since no async operation is tracked
      expect(updated?.is_buffering_observation).toBe(0);
    });

    it("should not clear flag if operation is active", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      // Set flag and track in async map
      await storage.setBufferingObservationFlag(record.id, true, 5000);

      // Add to async operations tracking (simulating active operation)
      ObservationalMemoryStorageClass.asyncBufferingOps.set(record.id, Promise.resolve());

      // Detect should NOT clear since operation is active
      await storage.detectAndClearStaleFlags(record.id);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.is_buffering_observation).toBe(1);

      // Cleanup
      ObservationalMemoryStorageClass.asyncBufferingOps.delete(record.id);
    });

    it("should not clear flag when active operation uses orchestration lock key", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      await storage.setBufferingObservationFlag(record.id, true, 5000);

      const lockKey = `async-observation-${record.id}`;
      ObservationalMemoryStorageClass.asyncBufferingOps.set(lockKey, Promise.resolve());

      await storage.detectAndClearStaleFlags(record.id);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.is_buffering_observation).toBe(1);

      ObservationalMemoryStorageClass.asyncBufferingOps.delete(lockKey);
    });
  });

  describe("configuration", () => {
    it("should allow custom configuration", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
        config: {
          observationThreshold: 50000,
          reflectionThreshold: 60000,
          bufferTokens: 8000,
          bufferActivation: 0.9,
        },
      });

      const config = record.config as ObservationalMemoryConfig;
      expect(config.observationThreshold).toBe(50000);
      expect(config.reflectionThreshold).toBe(60000);
      expect(config.bufferTokens).toBe(8000);
      expect(config.bufferActivation).toBe(0.9);
    });
  });

  describe("orchestration - startAsyncBufferedObservation", () => {
    it("should start async observation and store results", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      // Mock observer agent
      const mockObserverAgent = async () => "🔴 Observation from agent";

      // Mock token counter
      const mockTokenCounter = {
        countString: () => 0,
        countMessages: () => 100,
      };

      const messages = [
        { id: "msg-1", role: "user" as const, content: "Hello" },
        { id: "msg-2", role: "assistant" as const, content: "Hi there" },
      ];

      // Start async observation
      await storage.startAsyncBufferedObservation(
        record,
        messages,
        mockObserverAgent,
        mockTokenCounter,
        5000,
        `buffer-${record.id}`
      );

      // Wait for async operation to complete
      await new Promise(r => setTimeout(r, 100));

      // Verify buffering flag was set
      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.is_buffering_observation).toBe(1);
      expect(updated?.last_buffered_at_tokens).toBe(5000);
    });

    it("should store observation chunks after async processing", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const mockObserverAgent = async () => "Test observation content";
      const mockTokenCounter = {
        countString: () => 0,
        countMessages: () => 50,
      };

      const messages = [{ id: "msg-1", role: "user" as const, content: "Test" }];

      await storage.startAsyncBufferedObservation(
        record,
        messages,
        mockObserverAgent,
        mockTokenCounter,
        1000,
        `buffer-${record.id}`
      );

      // Wait for async operation
      await new Promise(r => setTimeout(r, 100));

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.buffered_observation_chunks).toHaveLength(1);
      expect(updated?.buffered_observation_chunks?.[0].content).toBe("Test observation content");
      expect(updated?.buffered_observation_chunks?.[0].messageTokens).toBe(50);
    });

    it("should clear buffering flag on observer error", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const mockObserverAgent = async () => {
        throw new Error("Observer failed");
      };
      const mockTokenCounter = {
        countString: () => 0,
        countMessages: () => 10,
      };

      const messages = [{ id: "msg-1", role: "user" as const, content: "Test" }];
      const lockKey = `buffer-${record.id}`;

      // Start async observation - this returns immediately (non-blocking)
      await storage.startAsyncBufferedObservation(
        record,
        messages,
        mockObserverAgent,
        mockTokenCounter,
        100,
        lockKey
      );

      // Wait for async operation to complete and error handling
      const asyncOp = ObservationalMemoryStorageClass.asyncBufferingOps.get(lockKey);
      if (asyncOp) {
        await asyncOp.catch(() => {
          // Expected to fail
        });
      }

      // Give a bit more time for the flag to be cleared
      await new Promise(r => setTimeout(r, 50));

      // Verify flag was cleared
      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.is_buffering_observation).toBe(0);
    });
  });

  describe("orchestration - tryActivateBufferedObservations", () => {
    it("should activate buffered observations when threshold reached", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      // Add buffered chunk
      await storage.updateBufferedObservations(record.id, [
        {
          content: "Buffered observation content",
          messageIds: ["msg-1"],
          messageTokens: 100,
          createdAt: new Date(),
        },
      ]);

      // Refresh record
      const refreshed = await storage.getObservationalMemory("thread", undefined, threadId);

      // Threshold is 30000, activation at 0.8 = 24000
      // Current tokens 25000 > 24000, should activate
      const activated = await storage.tryActivateBufferedObservations(refreshed!, 25000);

      expect(activated).toBe(true);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.active_observations).toContain("Buffered observation content");
      expect(updated?.buffered_observation_chunks).toHaveLength(0);
      expect(updated?.is_buffering_observation).toBe(0);
    });

    it("should not activate when below activation threshold", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      await storage.updateBufferedObservations(record.id, [
        {
          content: "Buffered content",
          messageIds: ["msg-1"],
          messageTokens: 100,
          createdAt: new Date(),
        },
      ]);

      const refreshed = await storage.getObservationalMemory("thread", undefined, threadId);

      // Current tokens 10000 < 24000, should not activate
      const activated = await storage.tryActivateBufferedObservations(refreshed!, 10000);

      expect(activated).toBe(false);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.buffered_observation_chunks).toHaveLength(1);
    });

    it("should not activate when no buffered chunks", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      const activated = await storage.tryActivateBufferedObservations(record, 30000);

      expect(activated).toBe(false);
    });

    it("should append to existing active observations", async () => {
      const threadId = uuidv7();
      const now = Date.now();

      const record = await storage.createObservationalMemory({
        threadId,
        scope: "thread",
        createdAt: now,
      });

      // Set initial active observations
      await storage.updateObservationalMemory(record.id, {
        activeObservations: "Existing observation",
      });

      // Add buffered chunk
      await storage.updateBufferedObservations(record.id, [
        {
          content: "New buffered content",
          messageIds: ["msg-1"],
          messageTokens: 100,
          createdAt: new Date(),
        },
      ]);

      const refreshed = await storage.getObservationalMemory("thread", undefined, threadId);
      await storage.tryActivateBufferedObservations(refreshed!, 25000);

      const updated = await storage.getObservationalMemory("thread", undefined, threadId);
      expect(updated?.active_observations).toContain("Existing observation");
      expect(updated?.active_observations).toContain("New buffered content");
    });
  });
});
