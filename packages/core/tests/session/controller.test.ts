/**
 * Tests for session controller
 *
 * These tests validate the session controller that manages
 * workflow execution and user message processing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionController } from "../../src/session/controller";
import { SessionConfig } from "../../src/session/types";

vi.mock("../../src/agent/workflow/factory", () => ({
  createAgent: vi.fn(() => ({
    id: "test-agent",
    type: "build",
    model: "test-model",
    systemPrompt: "test",
    tools: {},
    maxIterations: 1,
  })),
}));

vi.mock("../../src/session/processor", () => ({
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
}));

describe("session/controller", () => {
  let mockCheckpointDir: string;
  let mockConfig: SessionConfig;

  beforeEach(() => {
    mockCheckpointDir = "/tmp/test-checkpoints";
    mockConfig = {
      resourceId: "local",
      task: "Test task",
      workspace: "/test/workspace",
    };
  });

  describe("constructor", () => {
    it("should create controller with session ID", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      expect(controller).toBeDefined();
      expect(controller.sessionId).toBe("test-session");
    });

    it("should start in idle phase", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      expect(controller.getStatus().phase).toBe("idle");
    });
  });

  describe("processMessage", () => {
    it("should run the controller with a task", async () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      const result = await controller.processMessage("Test task");

      expect(result).toBeDefined();
      expect(result.status).toBe("completed");
      expect(controller.getStatus().phase).toBe("completed");
    });
  });

  describe("getStatus", () => {
    it("should return session status", () => {
      const controller = new SessionController({
        sessionId: "test-session",
        sessionConfig: mockConfig,
        checkpointDir: mockCheckpointDir,
      });

      const status = controller.getStatus();

      expect(status).toBeDefined();
      expect(status.sessionId).toBe("test-session");
      expect(status.phase).toBe("idle");
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
