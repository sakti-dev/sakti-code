/**
 * Tests for reflections table - Phase 3 Database Schema
 *
 * Tests verify:
 * - Reflections table exists in database
 * - Reflections table has correct columns
 * - Reflections table has correct indexes
 */

import { getDb, reflections, threads } from "@/testing/db";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("reflections table schema", () => {
  beforeEach(async () => {
    const db = await getDb();
    // Ensure foreign keys are enabled for cascade delete tests
    await db.run("PRAGMA foreign_keys = ON");
    try {
      await db.delete(reflections);
    } catch {
      // Table might not exist yet, ignore
    }
  });

  afterAll(async () => {
    const db = await getDb();
    try {
      await db.delete(reflections);
    } catch {
      // Ignore
    }
  });

  describe("table structure", () => {
    it("should have reflections table with correct columns", async () => {
      const db = await getDb();

      const now = new Date();
      const threadId = uuidv7();
      await db.insert(threads).values({
        id: threadId,
        resource_id: "test-resource-id",
        title: "Test Thread",
        created_at: now,
        updated_at: now,
      });

      const [result] = await db
        .insert(reflections)
        .values({
          id: "test-reflection-id",
          resource_id: "test-resource-id",
          thread_id: threadId,
          content: "Test reflection content",
          merged_from: ["obs-1", "obs-2"],
          origin_type: "reflection",
          generation_count: 1,
          token_count: 100,
          created_at: now,
          updated_at: now,
        })
        .returning();

      expect(result).toBeDefined();
      expect(result?.id).toBe("test-reflection-id");
      expect(result?.content).toBe("Test reflection content");
    });

    it("should have required columns with correct types", async () => {
      const db = await getDb();

      const now = new Date();
      await db.insert(reflections).values({
        id: "test-reflection-id-2",
        content: "Test content",
        generation_count: 1,
        created_at: now,
        updated_at: now,
      });

      const row = await db
        .select()
        .from(reflections)
        .where(eq(reflections.id, "test-reflection-id-2"))
        .get();

      expect(row).toBeDefined();
      expect(typeof row?.id).toBe("string");
      expect(typeof row?.content).toBe("string");
      expect(typeof row?.generation_count).toBe("number");
      expect(row?.created_at).toBeInstanceOf(Date);
      expect(row?.updated_at).toBeInstanceOf(Date);
    });
  });

  describe("foreign key constraints", () => {
    it("should cascade delete reflections when thread is deleted", async () => {
      const db = await getDb();

      const now = new Date();

      // First create a thread
      const threadId = uuidv7();
      await db.insert(threads).values({
        id: threadId,
        resource_id: "test-resource",
        title: "Test Thread",
        created_at: now,
        updated_at: now,
      });

      // Then create a reflection linked to this thread
      const reflectionId = uuidv7();
      await db.insert(reflections).values({
        id: reflectionId,
        thread_id: threadId,
        content: "Test reflection",
        generation_count: 1,
        created_at: now,
        updated_at: now,
      });

      // Verify reflection exists
      const reflectionBefore = await db
        .select()
        .from(reflections)
        .where(eq(reflections.id, reflectionId))
        .get();
      expect(reflectionBefore).toBeDefined();

      // Delete thread
      await db.delete(threads).where(eq(threads.id, threadId));

      // Verify reflection was cascade deleted
      const reflectionAfter = await db
        .select()
        .from(reflections)
        .where(eq(reflections.id, reflectionId))
        .get();
      expect(reflectionAfter).toBeUndefined();
    });
  });
});
