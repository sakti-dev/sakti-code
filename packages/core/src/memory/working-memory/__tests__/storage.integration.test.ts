/**
 * Tests for WorkingMemoryStorage CRUD operations
 *
 * Phase 4 Memory System - Working Memory storage tests.
 * Tests verify:
 * - createWorkingMemory: Create new working memory
 * - getWorkingMemory: Retrieve working memory by resourceId and scope
 * - updateWorkingMemory: Update working memory content
 * - upsertWorkingMemory: Create or update working memory
 * - deleteWorkingMemory: Delete working memory
 * - listWorkingMemoryByResource: List all working memories for a resource
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("WorkingMemoryStorage", () => {
  let storage: import("@/memory/working-memory/storage").WorkingMemoryStorage;

  beforeEach(async () => {
    const { WorkingMemoryStorage } = await import("@/memory/working-memory/storage");
    storage = new WorkingMemoryStorage();

    const { getDb } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();

    await db.run(sql`DELETE FROM working_memory`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("createWorkingMemory", () => {
    it("should create working memory with required fields", async () => {
      const resourceId = uuidv7();
      const content = "# Project Context\n- Language: TypeScript";

      const memory = await storage.createWorkingMemory({
        resourceId,
        content,
      });

      expect(memory).toBeDefined();
      expect(memory.id).toBeDefined();
      expect(memory.resource_id).toBe(resourceId);
      expect(memory.content).toBe(content);
      expect(memory.scope).toBe("resource");
      expect(memory.created_at).toBeInstanceOf(Date);
      expect(memory.updated_at).toBeInstanceOf(Date);
    });

    it("should create working memory with thread scope", async () => {
      const resourceId = uuidv7();

      const memory = await storage.createWorkingMemory({
        resourceId,
        scope: "thread",
        content: "# Thread Context",
      });

      expect(memory.scope).toBe("thread");
    });

    it("should create working memory with custom id", async () => {
      const customId = uuidv7();
      const memory = await storage.createWorkingMemory({
        id: customId,
        resourceId: uuidv7(),
        content: "Test content",
      });

      expect(memory.id).toBe(customId);
    });
  });

  describe("getWorkingMemory", () => {
    it("should return null for non-existent memory", async () => {
      const memory = await storage.getWorkingMemory(uuidv7(), "resource");
      expect(memory).toBeNull();
    });

    it("should get working memory by resourceId and scope", async () => {
      const resourceId = uuidv7();
      const content = "# Test Memory";

      await storage.createWorkingMemory({ resourceId, content });

      const memory = await storage.getWorkingMemory(resourceId, "resource");

      expect(memory).toBeDefined();
      expect(memory?.resource_id).toBe(resourceId);
      expect(memory?.content).toBe(content);
    });

    it("should distinguish between resource and thread scope", async () => {
      const resourceId = uuidv7();

      await storage.createWorkingMemory({
        resourceId,
        content: "Resource content",
        scope: "resource",
      });
      await storage.createWorkingMemory({ resourceId, content: "Thread content", scope: "thread" });

      const resourceMemory = await storage.getWorkingMemory(resourceId, "resource");
      const threadMemory = await storage.getWorkingMemory(resourceId, "thread");

      expect(resourceMemory?.content).toBe("Resource content");
      expect(threadMemory?.content).toBe("Thread content");
    });
  });

  describe("updateWorkingMemory", () => {
    it("should update existing working memory content", async () => {
      const resourceId = uuidv7();

      await storage.createWorkingMemory({ resourceId, content: "Original content" });

      const updated = await storage.updateWorkingMemory(resourceId, {
        content: "Updated content",
      });

      expect(updated).toBeDefined();
      expect(updated?.content).toBe("Updated content");
    });

    it("should return null for non-existent memory", async () => {
      const updated = await storage.updateWorkingMemory(uuidv7(), {
        content: "New content",
      });

      expect(updated).toBeNull();
    });
  });

  describe("upsertWorkingMemory", () => {
    it("should create new working memory if not exists", async () => {
      const resourceId = uuidv7();
      const content = "# New Project";

      const result = await storage.upsertWorkingMemory(resourceId, { resourceId, content });

      expect(result).toBeDefined();
      expect(result.content).toBe(content);
    });

    it("should update existing working memory if exists", async () => {
      const resourceId = uuidv7();

      await storage.createWorkingMemory({ resourceId, content: "Original" });

      const result = await storage.upsertWorkingMemory(resourceId, {
        resourceId,
        content: "Updated",
      });

      expect(result.content).toBe("Updated");

      const all = await storage.listWorkingMemoryByResource(resourceId);
      expect(all.length).toBe(1);
    });
  });

  describe("deleteWorkingMemory", () => {
    it("should delete existing working memory", async () => {
      const resourceId = uuidv7();

      await storage.createWorkingMemory({ resourceId, content: "To delete" });

      const deleted = await storage.deleteWorkingMemory(resourceId, "resource");

      expect(deleted).toBe(true);

      const memory = await storage.getWorkingMemory(resourceId, "resource");
      expect(memory).toBeNull();
    });

    it("should return false for non-existent memory", async () => {
      const deleted = await storage.deleteWorkingMemory(uuidv7(), "resource");
      expect(deleted).toBe(false);
    });
  });

  describe("listWorkingMemoryByResource", () => {
    it("should list all working memories for a resource", async () => {
      const resourceId = uuidv7();

      await storage.createWorkingMemory({ resourceId, content: "Resource 1", scope: "resource" });
      await storage.createWorkingMemory({ resourceId, content: "Thread 1", scope: "thread" });

      const all = await storage.listWorkingMemoryByResource(resourceId);

      expect(all.length).toBe(2);
    });

    it("should return empty array for resource with no memory", async () => {
      const all = await storage.listWorkingMemoryByResource(uuidv7());
      expect(all).toEqual([]);
    });
  });
});
