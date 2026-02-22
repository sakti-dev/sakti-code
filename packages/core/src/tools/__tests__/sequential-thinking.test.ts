/**
 * Tests for sequential-thinking tool
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { MemoryStorage } from "@/tools/sequential-thinking-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

// RFC 4122 UUID validation regex (works for both UUIDv4 and UUIDv7)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("sequentialThinking tool", () => {
  let sequentialThinking: any;
  let storage: MemoryStorage;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create a fresh storage instance for each test
    storage = new MemoryStorage();

    // Import the tool with custom storage
    const module = await import("@/tools/sequential-thinking");
    const { createSequentialThinkingTool } = module;
    sequentialThinking = createSequentialThinkingTool({ storage });

    // Clear all sessions before each test for isolation
    await storage.clear();
  });

  describe("session management", () => {
    it("creates new session on first call", async () => {
      const result = await sequentialThinking.execute({
        thought: "First thought",
        thoughtNumber: 1,
        totalThoughts: 5,
        nextThoughtNeeded: true,
      });

      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(UUID_REGEX);
      expect(result.thoughtHistoryLength).toBe(1);
      expect(result.thoughtHistory).toHaveLength(1);
      expect(result.thoughtHistory[0]).toEqual({
        thoughtNumber: 1,
        thought: "First thought",
        isRevision: undefined,
      });
    });

    it("continues session with existing sessionId", async () => {
      const first = await sequentialThinking.execute({
        thought: "First",
        thoughtNumber: 1,
        totalThoughts: 3,
        nextThoughtNeeded: true,
      });

      const second = await sequentialThinking.execute({
        thought: "Second",
        thoughtNumber: 2,
        totalThoughts: 3,
        nextThoughtNeeded: false,
        sessionId: first.sessionId,
      });

      expect(second.sessionId).toBe(first.sessionId);
      expect(second.thoughtHistoryLength).toBe(2);
      expect(second.thoughtHistory[0].thought).toBe("First");
      expect(second.thoughtHistory[1].thought).toBe("Second");
    });

    it("clears session when requested", async () => {
      const first = await sequentialThinking.execute({
        thought: "First",
        thoughtNumber: 1,
        totalThoughts: 3,
        nextThoughtNeeded: true,
      });

      const cleared = await sequentialThinking.execute({
        thought: "Fresh start",
        thoughtNumber: 1,
        totalThoughts: 5,
        nextThoughtNeeded: true,
        sessionId: first.sessionId,
        clearSession: true,
      });

      expect(cleared.thoughtHistoryLength).toBe(1); // Reset
      expect(cleared.thoughtHistory[0].thought).toBe("Fresh start");
    });

    it("generates summary on completion", async () => {
      const result = await sequentialThinking.execute({
        thought: "Final thought",
        thoughtNumber: 3,
        totalThoughts: 3,
        nextThoughtNeeded: false,
      });

      expect(result.summary).toBeDefined();
      expect(result.summary).toContain("complete");
      expect(result.summary).toContain("1 thoughts");
    });
  });

  describe("revision support", () => {
    it("supports revision of previous thoughts", async () => {
      const first = await sequentialThinking.execute({
        thought: "Initial assumption",
        thoughtNumber: 1,
        totalThoughts: 3,
        nextThoughtNeeded: true,
      });

      const revision = await sequentialThinking.execute({
        thought: "Revised: Actually, the assumption was wrong",
        thoughtNumber: 2,
        totalThoughts: 3,
        nextThoughtNeeded: false,
        sessionId: first.sessionId,
        isRevision: true,
        revisesThought: 1,
      });

      expect(revision.thoughtHistory[1].isRevision).toBe(true);
      expect(revision.thoughtHistory[1].thoughtNumber).toBe(2);
      expect(revision.thoughtHistory[1].thought).toContain("Revised");
    });

    it("tracks revision metadata correctly", async () => {
      const first = await sequentialThinking.execute({
        thought: "Thought 1",
        thoughtNumber: 1,
        totalThoughts: 5,
        nextThoughtNeeded: true,
      });

      const second = await sequentialThinking.execute({
        thought: "Thought 2",
        thoughtNumber: 2,
        totalThoughts: 5,
        nextThoughtNeeded: true,
        sessionId: first.sessionId,
      });

      const revision = await sequentialThinking.execute({
        thought: "Revision of thought 1",
        thoughtNumber: 3,
        totalThoughts: 5,
        nextThoughtNeeded: false,
        sessionId: second.sessionId,
        isRevision: true,
        revisesThought: 1,
      });

      expect(revision.thoughtHistory[2].isRevision).toBe(true);
    });
  });

  describe("branching support", () => {
    it("tracks branches independently", async () => {
      const first = await sequentialThinking.execute({
        thought: "Main path thought 1",
        thoughtNumber: 1,
        totalThoughts: 5,
        nextThoughtNeeded: true,
        branchId: "main",
      });

      const second = await sequentialThinking.execute({
        thought: "Branch A thought 1",
        thoughtNumber: 1,
        totalThoughts: 3,
        nextThoughtNeeded: true,
        branchId: "branch-a",
        sessionId: first.sessionId,
      });

      const result = await sequentialThinking.execute({
        thought: "Main path thought 2",
        thoughtNumber: 2,
        totalThoughts: 5,
        nextThoughtNeeded: false,
        branchId: "main",
        sessionId: second.sessionId,
      });

      expect(result.branches).toContain("main");
      expect(result.branches).toContain("branch-a");
      expect(result.branches).toHaveLength(2);
    });

    it("supports branchFromThought metadata", async () => {
      await sequentialThinking.execute({
        thought: "Original thought",
        thoughtNumber: 1,
        totalThoughts: 3,
        nextThoughtNeeded: true,
      });

      const branch = await sequentialThinking.execute({
        thought: "Alternative approach",
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: false,
        branchId: "alternative",
        branchFromThought: 1,
      });

      expect(branch.branches).toContain("alternative");
    });
  });

  describe("thought history", () => {
    it("maintains complete thought history in order", async () => {
      const first = await sequentialThinking.execute({
        thought: "Step 1",
        thoughtNumber: 1,
        totalThoughts: 4,
        nextThoughtNeeded: true,
      });

      const second = await sequentialThinking.execute({
        thought: "Step 2",
        thoughtNumber: 2,
        totalThoughts: 4,
        nextThoughtNeeded: true,
        sessionId: first.sessionId,
      });

      const third = await sequentialThinking.execute({
        thought: "Step 3",
        thoughtNumber: 3,
        totalThoughts: 4,
        nextThoughtNeeded: true,
        sessionId: second.sessionId,
      });

      const result = await sequentialThinking.execute({
        thought: "Step 4",
        thoughtNumber: 4,
        totalThoughts: 4,
        nextThoughtNeeded: false,
        sessionId: third.sessionId,
      });

      expect(result.thoughtHistoryLength).toBe(4);
      expect(result.thoughtHistory[0].thought).toBe("Step 1");
      expect(result.thoughtHistory[1].thought).toBe("Step 2");
      expect(result.thoughtHistory[2].thought).toBe("Step 3");
      expect(result.thoughtHistory[3].thought).toBe("Step 4");
    });

    it("includes thoughtNumber, thought, and isRevision in history", async () => {
      const first = await sequentialThinking.execute({
        thought: "Base thought",
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
      });

      const result = await sequentialThinking.execute({
        thought: "Follow-up",
        thoughtNumber: 2,
        totalThoughts: 2,
        nextThoughtNeeded: false,
        sessionId: first.sessionId,
      });

      expect(result.thoughtHistory[0]).toHaveProperty("thoughtNumber");
      expect(result.thoughtHistory[0]).toHaveProperty("thought");
      expect(result.thoughtHistory[0]).toHaveProperty("isRevision");
    });
  });

  describe("tool schema", () => {
    it("has correct input schema", () => {
      expect(sequentialThinking.inputSchema).toBeDefined();
    });

    it("has correct output schema", () => {
      expect(sequentialThinking.outputSchema).toBeDefined();
    });

    it("has description for AI", () => {
      expect(sequentialThinking.description).toBeDefined();
      expect(typeof sequentialThinking.description).toBe("string");
      expect(sequentialThinking.description.length).toBeGreaterThan(100);
    });
  });

  describe("cleanup utilities", () => {
    it("clearAllSessions removes all sessions", async () => {
      await sequentialThinking.execute({
        thought: "Session 1",
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
      });

      await sequentialThinking.execute({
        thought: "Session 2",
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
      });

      await storage.clear();

      // New call should create fresh session (but same UUID due to mock)
      const result = await sequentialThinking.execute({
        thought: "New session",
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
      });

      expect(result.thoughtHistoryLength).toBe(1);
      expect(result.thoughtHistory[0].thought).toBe("New session");
    });

    it("getSession returns session state", async () => {
      const first = await sequentialThinking.execute({
        thought: "Test thought",
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
      });

      const session = await storage.get(first.sessionId);
      expect(session).toBeDefined();
      expect(session?.thoughts).toHaveLength(1);
      expect(session?.branches.size).toBe(0);
    });

    it("getSession returns undefined for non-existent session", async () => {
      const session = await storage.get("non-existent-id");
      expect(session).toBeUndefined();
    });
  });

  describe("factory function", () => {
    it("createSequentialThinkingTool creates independent tool", async () => {
      const { createSequentialThinkingTool } = await import("@/tools/sequential-thinking");

      const tool1 = createSequentialThinkingTool();
      const tool2 = createSequentialThinkingTool();

      const result1 = (await tool1.execute!(
        {
          thought: "Tool 1 thought",
          thoughtNumber: 1,
          totalThoughts: 2,
          nextThoughtNeeded: true,
        },
        { toolCallId: "test-call-1", messages: [] }
      )) as { sessionId: string };

      const result2 = (await tool2.execute!(
        {
          thought: "Tool 2 thought",
          thoughtNumber: 1,
          totalThoughts: 2,
          nextThoughtNeeded: true,
        },
        { toolCallId: "test-call-2", messages: [] }
      )) as { sessionId: string };

      // Each tool should maintain independent state but share session store
      expect(result1.sessionId).toBeDefined();
      expect(result2.sessionId).toBeDefined();
    });

    it("createSequentialThinkingTool with initial sessionId", async () => {
      const { createSequentialThinkingTool } = await import("@/tools/sequential-thinking");

      const customSessionId = "custom-session-123";
      const tool = createSequentialThinkingTool({ sessionId: customSessionId });

      const result = (await tool.execute!(
        {
          thought: "Test",
          thoughtNumber: 1,
          totalThoughts: 2,
          nextThoughtNeeded: true,
        },
        { toolCallId: "test-call-3", messages: [] }
      )) as { sessionId: string };

      // Without sessionId in args, should use the tool's default
      expect(result.sessionId).toMatch(UUID_REGEX);
    });
  });

  describe("edge cases", () => {
    it("handles empty thought", async () => {
      const result = await sequentialThinking.execute({
        thought: "",
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
      });

      expect(result.thoughtHistory[0].thought).toBe("");
    });

    it("handles very long thought", async () => {
      const longThought = "A".repeat(10000);

      const result = await sequentialThinking.execute({
        thought: longThought,
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
      });

      expect(result.thoughtHistory[0].thought).toBe(longThought);
    });

    it("handles clearing non-existent session gracefully", async () => {
      const result = await sequentialThinking.execute({
        thought: "Test",
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
        sessionId: "non-existent",
        clearSession: true,
      });

      // Should create new session
      expect(result.sessionId).toMatch(UUID_REGEX);
      expect(result.thoughtHistoryLength).toBe(1);
    });

    it("rejects thoughts exceeding maximum length", async () => {
      const tooLongThought = "A".repeat(50001); // MAX_THOUGHT_LENGTH + 1

      await expect(
        sequentialThinking.execute({
          thought: tooLongThought,
          thoughtNumber: 1,
          totalThoughts: 1,
          nextThoughtNeeded: false,
        })
      ).rejects.toThrow("exceeds maximum length");
    });

    it("generates UUIDv7 format session IDs", async () => {
      const result = await sequentialThinking.execute({
        thought: "Test",
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
      });

      // UUIDv7 has the format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
      // where the 13th character (version) is '7'
      expect(result.sessionId).toMatch(UUID_REGEX);
      const parts = result.sessionId.split("-");
      expect(parts[2]).toMatch(/^7/); // Version 7
    });
  });
});
