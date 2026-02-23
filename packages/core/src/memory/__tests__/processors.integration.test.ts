/**
 * Tests for MemoryProcessor - Input/Output processors
 *
 * Phase 4 Memory System - MemoryProcessor tests.
 * Tests verify:
 * - input: Retrieves working memory and recent messages
 * - output: Persists messages to storage
 * - formatForAgentInput: Formats context for LLM injection
 */

import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

describe("MemoryProcessor", () => {
  let MemoryProcessor: typeof import("@/memory/processors").MemoryProcessor;
  let threadId: string;
  let resourceId: string;

  beforeEach(async () => {
    const mod = await import("@/memory/processors");
    MemoryProcessor = mod.MemoryProcessor;

    // Clean up test data
    const { getDb } = await import("@/testing/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    await db.run(sql`DELETE FROM working_memory`);
    await db.run(sql`DELETE FROM messages`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  describe("input", () => {
    it("should retrieve working memory for resource", async () => {
      const { workingMemoryStorage } = await import("@/memory/working-memory/storage");
      const resourceId = uuidv7();
      const content = "# Project Context\n- Language: TypeScript";

      await workingMemoryStorage.createWorkingMemory({ resourceId, content });

      const result = await MemoryProcessor.input({
        message: "test",
        threadId: uuidv7(),
        resourceId,
      });

      expect(result.workingMemory).toContain("TypeScript");
    });

    it("should use default template when no working memory exists", async () => {
      const result = await MemoryProcessor.input({
        message: "test",
        threadId: uuidv7(),
        resourceId: uuidv7(),
      });

      expect(result.workingMemory).toContain("Project Context");
    });

    it("should return recent messages", async () => {
      const { messageStorage } = await import("@/memory/message/storage");
      const { threads } = await import("@/testing/db");
      const { getDb } = await import("@/testing/db");

      const threadId = uuidv7();
      const resourceId = uuidv7();

      // Create thread first (required for messages due to foreign key)
      const db = await getDb();
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        created_at: new Date(),
        updated_at: new Date(),
      });

      const now = Date.now();

      // Create some test messages
      await messageStorage.createMessage({
        id: uuidv7(),
        threadId,
        resourceId,
        role: "user",
        rawContent: "Hello",
        createdAt: now,
        messageIndex: 0,
      });

      const result = await MemoryProcessor.input({
        message: "test",
        threadId,
        resourceId,
      });

      expect(result.recentMessages.length).toBeGreaterThanOrEqual(1);
    });

    it("should preserve original message", async () => {
      const threadId = uuidv7();
      const resourceId = uuidv7();

      const result = await MemoryProcessor.input({
        message: "Implement login feature",
        threadId,
        resourceId,
      });

      expect(result.originalMessage).toBe("Implement login feature");
    });

    it("should apply semantic recall topK/messageRange within thread scope", async () => {
      const { messageStorage } = await import("@/memory/message/storage");
      const { getDb, threads } = await import("@/testing/db");

      const threadId = uuidv7();
      const resourceId = uuidv7();
      const db = await getDb();
      const now = Date.now();

      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Semantic Recall Thread",
        created_at: new Date(now),
        updated_at: new Date(now),
      });

      for (let i = 0; i < 6; i++) {
        await messageStorage.createMessage({
          id: uuidv7(),
          threadId,
          resourceId,
          role: "assistant",
          rawContent: i === 3 ? "contains semantic_needle token" : `filler-${i}`,
          searchText: i === 3 ? "contains semantic_needle token" : `filler-${i}`,
          injectionText: i === 3 ? "contains semantic_needle token" : `filler-${i}`,
          createdAt: now + i,
          messageIndex: i,
        });
      }

      const result = await MemoryProcessor.input({
        message: "semantic_needle",
        threadId,
        resourceId,
        semanticRecall: {
          topK: 1,
          messageRange: 1,
          scope: "thread",
        },
      });

      const indices = result.recentMessages.map(msg => msg.messageIndex).sort((a, b) => a - b);
      expect(indices).toEqual([2, 3, 4]);
    });

    it("should support semantic recall with resource scope across threads", async () => {
      const { messageStorage } = await import("@/memory/message/storage");
      const { getDb, threads } = await import("@/testing/db");

      const resourceId = uuidv7();
      const threadId1 = uuidv7();
      const threadId2 = uuidv7();
      const db = await getDb();
      const now = Date.now();

      await db.insert(threads).values([
        {
          id: threadId1,
          resource_id: resourceId,
          title: "Primary Thread",
          created_at: new Date(now),
          updated_at: new Date(now),
        },
        {
          id: threadId2,
          resource_id: resourceId,
          title: "Secondary Thread",
          created_at: new Date(now),
          updated_at: new Date(now),
        },
      ]);

      await messageStorage.createMessage({
        id: uuidv7(),
        threadId: threadId2,
        resourceId,
        role: "assistant",
        rawContent: "resource_scope_keyphrase appears here",
        searchText: "resource_scope_keyphrase appears here",
        injectionText: "resource_scope_keyphrase appears here",
        createdAt: now + 1,
        messageIndex: 0,
      });

      const result = await MemoryProcessor.input({
        message: "resource_scope_keyphrase",
        threadId: threadId1,
        resourceId,
        semanticRecall: {
          topK: 1,
          messageRange: 0,
          scope: "resource",
        },
      });

      expect(result.recentMessages.some(msg => msg.threadId === threadId2)).toBe(true);
    });
  });

  describe("output", () => {
    beforeEach(async () => {
      threadId = uuidv7();
      resourceId = uuidv7();

      // Create thread first (required for messages due to foreign key)
      const { getDb } = await import("@/testing/db");
      const { threads } = await import("@/testing/db");
      const db = await getDb();
      await db.insert(threads).values({
        id: threadId,
        resource_id: resourceId,
        title: "Test Thread",
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    it("should persist messages to storage", async () => {
      const { messageStorage } = await import("@/memory/message/storage");

      const result = await MemoryProcessor.output({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        threadId,
        resourceId,
      });

      expect(result.success).toBe(true);
      expect(result.messagesPersisted).toBe(2);

      const messages = await messageStorage.listMessages({ threadId });
      expect(messages.length).toBe(2);
    });

    it("should handle empty messages array", async () => {
      const result = await MemoryProcessor.output({
        messages: [],
        threadId,
        resourceId,
      });

      expect(result.success).toBe(true);
      expect(result.messagesPersisted).toBe(0);
    });

    it("should generate message IDs when not provided", async () => {
      const result = await MemoryProcessor.output({
        messages: [{ role: "user", content: "Test" }],
        threadId,
        resourceId,
      });

      expect(result.success).toBe(true);
      expect(result.messagesPersisted).toBe(1);
    });
  });

  describe("formatForAgentInput", () => {
    it("should format system prompt", () => {
      const inputResult = {
        originalMessage: "test",
        workingMemory: "# Project\nTypeScript",
        recentMessages: [],
      };

      const result = MemoryProcessor.formatForAgentInput(
        inputResult,
        "You are a helpful assistant"
      );

      expect(result[0].role).toBe("system");
      expect(result[0].content).toBe("You are a helpful assistant");
    });

    it("should include working memory when present", () => {
      const inputResult = {
        originalMessage: "test",
        workingMemory: "# Project\nTypeScript",
        recentMessages: [],
      };

      const result = MemoryProcessor.formatForAgentInput(inputResult, "System prompt");

      const wmMessage = result.find(m => m.content.includes("working-memory"));
      expect(wmMessage).toBeDefined();
      expect(wmMessage?.content).toContain("TypeScript");
    });

    it("should include recent messages", () => {
      const inputResult = {
        originalMessage: "test",
        workingMemory: "",
        recentMessages: [
          {
            id: "1",
            threadId: "thread-1",
            role: "user" as const,
            rawContent: "Hello",
            injectionText: "Hello",
            createdAt: Date.now(),
            messageIndex: 0,
          },
          {
            id: "2",
            threadId: "thread-1",
            role: "assistant" as const,
            rawContent: "Hi",
            injectionText: "Hi",
            createdAt: Date.now(),
            messageIndex: 1,
          },
        ],
      };

      const result = MemoryProcessor.formatForAgentInput(inputResult, "System");

      expect(result.length).toBeGreaterThan(2);
    });

    it("should place user message last", () => {
      const inputResult = {
        originalMessage: "What is TypeScript?",
        workingMemory: "",
        recentMessages: [],
      };

      const result = MemoryProcessor.formatForAgentInput(inputResult, "System");

      expect(result[result.length - 1].role).toBe("user");
      expect(result[result.length - 1].content).toBe("What is TypeScript?");
    });

    it("should filter out tool messages from recent messages", () => {
      const inputResult = {
        originalMessage: "test",
        workingMemory: "",
        recentMessages: [
          {
            id: "1",
            threadId: "thread-1",
            role: "tool" as const,
            rawContent: "Tool output",
            injectionText: "Tool output",
            createdAt: Date.now(),
            messageIndex: 0,
          },
        ],
      };

      const result = MemoryProcessor.formatForAgentInput(inputResult, "System");

      // Should not include the tool message
      const roles = result.map(m => m.role);
      expect(roles).not.toContain("tool");
    });
  });
});
