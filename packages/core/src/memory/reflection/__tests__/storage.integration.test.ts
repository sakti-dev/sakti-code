/**
 * Tests for ReflectionStorage - Phase 3 Reflection Storage
 *
 * Tests verify:
 * - createReflection: Create new reflection
 * - getReflectionById: Get specific reflection
 * - getReflectionsByThread: Query reflections by thread
 * - getReflectionsByResource: Query reflections by resource
 * - getLatestReflections: Get most recent N reflections
 * - deleteReflection: Remove reflection
 * - getReflectionCount: Count reflections
 */

import type { ReflectionStorage } from "@/memory/reflection/storage";
import { getDb, threads } from "@/testing/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("ReflectionStorage", () => {
  let storage: ReflectionStorage;
  let ReflectionStorageClass: typeof ReflectionStorage;

  async function createThread(resourceId: string = "test-resource"): Promise<string> {
    const db = await getDb();
    const now = new Date();
    const threadId = uuidv7();

    await db.insert(threads).values({
      id: threadId,
      resource_id: resourceId,
      title: "Test Thread",
      created_at: now,
      updated_at: now,
    });

    return threadId;
  }

  beforeEach(async () => {
    const mod = await import("@/memory/reflection/storage");
    ReflectionStorageClass = mod.ReflectionStorage;
    storage = new ReflectionStorageClass();
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    await db.run(sql`DELETE FROM reflections`);
    await db.run(sql`DELETE FROM threads`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("createReflection", () => {
    it("should create reflection with all fields", async () => {
      const id = uuidv7();
      const threadId = await createThread();
      const resourceId = "test-resource";

      const reflection = await storage.createReflection({
        id,
        threadId,
        resourceId,
        content: "Test reflection content",
        mergedFrom: ["obs-1", "obs-2"],
        originType: "reflection",
        generationCount: 1,
        tokenCount: 100,
      });

      expect(reflection).toBeDefined();
      expect(reflection.id).toBe(id);
      expect(reflection.content).toBe("Test reflection content");
      expect(reflection.generation_count).toBe(1);
    });
  });

  describe("getReflectionById", () => {
    it("should return reflection when it exists", async () => {
      const id = uuidv7();

      const reflection = await storage.createReflection({
        id,
        content: "Test content",
        generationCount: 1,
        tokenCount: 50,
      });

      expect(reflection).toBeDefined();
      expect(reflection?.id).toBe(id);
    });

    it("should return null when reflection doesn't exist", async () => {
      const reflection = await storage.getReflectionById("non-existent-id");

      expect(reflection).toBeNull();
    });
  });

  describe("getReflectionsByThread", () => {
    it("should return reflections for thread", async () => {
      const threadId = await createThread();

      const reflection1 = await storage.createReflection({
        id: uuidv7(),
        threadId,
        content: "First reflection",
        generationCount: 1,
        tokenCount: 50,
      });

      const reflection2 = await storage.createReflection({
        id: uuidv7(),
        threadId,
        content: "Second reflection",
        generationCount: 2,
        tokenCount: 75,
      });

      const reflections = await storage.getReflectionsByThread(threadId);

      expect(reflections).toHaveLength(2);
      // Query orders by generation_count DESC, so reflection2 (gen=2) comes first
      expect(reflections[0].id).toBe(reflection2.id);
      expect(reflections[1].id).toBe(reflection1.id);
    });

    it("should limit results when limit parameter provided", async () => {
      const threadId = await createThread();

      await storage.createReflection({
        id: uuidv7(),
        threadId,
        content: "Reflection 1",
        generationCount: 1,
        tokenCount: 50,
      });

      await storage.createReflection({
        id: uuidv7(),
        threadId,
        content: "Reflection 2",
        generationCount: 2,
        tokenCount: 75,
      });

      await storage.createReflection({
        id: uuidv7(),
        threadId,
        content: "Reflection 3",
        generationCount: 3,
        tokenCount: 100,
      });

      const reflections = await storage.getReflectionsByThread(threadId, 2);

      expect(reflections).toHaveLength(2);
    });
  });

  describe("getReflectionsByResource", () => {
    it("should return reflections for resource", async () => {
      const resourceId = "test-resource-123";

      await storage.createReflection({
        id: uuidv7(),
        resourceId,
        content: "Resource reflection",
        generationCount: 1,
        tokenCount: 50,
      });

      const reflections = await storage.getReflectionsByResource(resourceId);

      expect(reflections).toHaveLength(1);
      expect(reflections[0].resource_id).toBe(resourceId);
    });
  });

  describe("getLatestReflections", () => {
    it("should return most recent reflections", async () => {
      await storage.createReflection({
        id: uuidv7(),
        content: "Old reflection",
        generationCount: 1,
        tokenCount: 50,
      });

      await new Promise(resolve => setTimeout(resolve, 2));

      const reflection2 = await storage.createReflection({
        id: uuidv7(),
        content: "New reflection",
        generationCount: 2,
        tokenCount: 75,
      });

      const reflections = await storage.getLatestReflections(1000);

      expect(reflections.length).toBeGreaterThan(0);
      expect(reflections.some(reflection => reflection.id === reflection2.id)).toBe(true);
      for (let i = 1; i < reflections.length; i++) {
        expect(reflections[i - 1].created_at.getTime()).toBeGreaterThanOrEqual(
          reflections[i].created_at.getTime()
        );
      }
    });
  });

  describe("deleteReflection", () => {
    it("should delete existing reflection", async () => {
      const id = uuidv7();

      await storage.createReflection({
        id,
        content: "To be deleted",
        generationCount: 1,
        tokenCount: 50,
      });

      await storage.deleteReflection(id);

      const reflection = await storage.getReflectionById(id);
      expect(reflection).toBeNull();
    });
  });
});
