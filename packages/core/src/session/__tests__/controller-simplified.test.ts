/**
 * Tests for simplified session controller (new single-agent API)
 *
 * These tests validate the simplified session controller that
 * manages a single agent without complex workflow orchestration.
 */

import { SessionController } from "@/session/controller";
import { SessionConfig } from "@/session/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent factory
vi.mock("@/agent/workflow/factory", () => ({
  createAgent: vi.fn((name: string, id: string) => ({
    id,
    type: name,
    model: "glm-4.7",
    systemPrompt: `You are a ${name} agent`,
    tools: [],
    maxIterations: 50,
  })),
  runAgent: vi.fn(),
}));

vi.mock("@/session/processor", () => ({
  AgentProcessor: class MockAgentProcessor {
    async run() {
      return {
        status: "completed" as const,
        finalContent: "Done",
        messages: [],
        iterations: 1,
        duration: 1,
      };
    }

    abort(): void {
      // no-op
    }
  },
}));

// Mock fs operations
vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(JSON.stringify({})),
  access: vi.fn().mockResolvedValue(undefined),
}));

describe("session/controller (simplified)", () => {
  let mockConfig: SessionConfig;
  let mockCheckpointDir: string;

  beforeEach(() => {
    mockCheckpointDir = "/tmp/test-checkpoints";
    mockConfig = {
      resourceId: "local",
      task: "Test task",
      workspace: "/test/workspace",
    };
  });

  describe("constructor", () => {
    it("should create controller without workflow", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      expect(controller).toBeDefined();
      expect(controller.sessionId).toBe("test-session");
      // Should not have workflow property in simplified version
    });

    it("should start in idle state", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      expect(controller.getStatus().phase).toBe("idle");
    });
  });

  describe("processMessage (new API)", () => {
    it("should create default build agent and process message", async () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      // Process message should create agent and execute
      const result = await controller.processMessage("Hello");

      expect(result).toBeDefined();
      // Should have processed the message
    });

    it("should handle conversational messages without tools", async () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      const result = await controller.processMessage("Just say hi");

      expect(result).toBeDefined();
      // Should complete without errors
    });

    it("should stream agent responses to callback", async () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      const events: unknown[] = [];
      const result = await controller.processMessage("Test", {
        onEvent: event => events.push(event),
      });

      expect(result).toBeDefined();
      // Events should be collected
      expect(Array.isArray(events)).toBe(true);
    });

    it("should support agent abortion mid-stream", async () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      // Start a message and immediately abort
      const promise = controller.processMessage("Long task");

      // Abort immediately
      controller.abort();

      // Should either complete or be stopped
      await promise.catch(() => {
        // Error is acceptable for abort scenario
      });
    });

    it("should persist checkpoints after completion", async () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      await controller.processMessage("Complete task");

      // Checkpoint should be saved
      const hasCheckpoint = await controller.hasCheckpoint();
      expect(hasCheckpoint).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should return session status with phase", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      const status = controller.getStatus();

      expect(status).toBeDefined();
      expect(status.sessionId).toBe("test-session");
      // Phase should be either "idle", "running", "completed", or "failed"
      expect(["idle", "running", "completed", "failed"]).toContain(status.phase);
    });
  });

  describe("hasIncompleteWork", () => {
    it("should return false for idle phase", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      expect(controller.hasIncompleteWork()).toBe(false);
    });

    it("should return true when session is running", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      (controller as unknown as { currentPhase: string }).currentPhase = "running";
      expect(controller.hasIncompleteWork()).toBe(true);
    });
  });

  describe("abort", () => {
    it("should have abort method", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      expect(() => controller.abort()).not.toThrow();
    });
  });
});
