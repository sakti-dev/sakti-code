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

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ReflectionStorage } from "../../src/memory/reflection/storage";

describe("ReflectionStorage", () => {
  let storage: ReflectionStorage;
  let ReflectionStorageClass: typeof ReflectionStorage;

  beforeEach(async () => {
    const mod = await import("../../../../src/memory/reflection/storage");
    ReflectionStorageClass = mod.ReflectionStorage;
    storage = new ReflectionStorageClass();
  });

  afterAll(async () => {
    const { closeDb } = await import("@ekacode/server/db");
    closeDb();
  });

  describe("createReflection", () => {
    it("should create reflection with all fields", async () => {
      const id = uuidv7();
      const threadId = uuidv7();
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
      const threadId = uuidv7();

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
      expect(reflections[0].id).toBe(reflection1.id);
      expect(reflections[1].id).toBe(reflection2.id);
    });

    it("should limit results when limit parameter provided", async () => {
      const threadId = uuidv7();

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
      const reflection2 = await storage.createReflection({
        id: uuidv7(),
        content: "New reflection",
        generationCount: 2,
        tokenCount: 75,
      });

      const reflections = await storage.getLatestReflections(5);

      expect(reflections.length).toBeGreaterThan(0);
      const newest = reflections[reflections.length - 1];
      expect(newest.id).toBe(reflection2.id);
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
