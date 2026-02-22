/**
 * Tests for session types
 *
 * These tests validate the type definitions for session management
 * in the new opencode-style agent architecture.
 */

import { Checkpoint, SessionConfig, SessionPhase, SessionStatus } from "@/session/types";
import { describe, expect, it } from "vitest";

describe("session/types", () => {
  describe("SessionPhase", () => {
    it("should accept valid session phases", () => {
      expect(SessionPhase.parse("idle")).toBe("idle");
      expect(SessionPhase.parse("running")).toBe("running");
      expect(SessionPhase.parse("completed")).toBe("completed");
      expect(SessionPhase.parse("failed")).toBe("failed");
    });

    it("should reject invalid session phases", () => {
      expect(() => SessionPhase.parse("invalid")).toThrow();
    });
  });

  describe("SessionStatus", () => {
    const validStatus = {
      sessionId: "test-session-id",
      phase: "idle" as const,
      progress: 0,
      hasIncompleteWork: false,
      summary: "Ready to start",
      lastActivity: Date.now(),
      activeAgents: [],
    };

    it("should accept valid session status", () => {
      const result = SessionStatus.safeParse(validStatus);
      expect(result.success).toBe(true);
    });

    it("should accept status with active agents", () => {
      const statusWithAgents = {
        ...validStatus,
        phase: "running" as const,
        progress: 0.5,
        hasIncompleteWork: true,
        activeAgents: ["build-0", "build-1", "build-2"],
      };
      const result = SessionStatus.safeParse(statusWithAgents);
      expect(result.success).toBe(true);
    });

    it("should accept status without lastActivity", () => {
      const statusWithoutTime = { ...validStatus, lastActivity: undefined };
      const result = SessionStatus.safeParse(statusWithoutTime);
      expect(result.success).toBe(true);
    });

    it("should calculate progress correctly", () => {
      const phases = ["idle", "running", "completed", "failed"] as const;
      const expectedProgress = [0, 0.5, 1, 1];

      phases.forEach((phase, idx) => {
        const status = {
          ...validStatus,
          phase,
          progress: expectedProgress[idx],
        };
        const result = SessionStatus.safeParse(status);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.progress).toBe(expectedProgress[idx]);
        }
      });
    });
  });

  describe("SessionConfig", () => {
    const validConfig = {
      resourceId: "local",
      task: "Test task",
      workspace: "/path/to/workspace",
    };

    it("should accept valid session config", () => {
      const result = SessionConfig.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should accept config with exploreInputs", () => {
      const configWithInputs = {
        ...validConfig,
        exploreInputs: ["input1", "input2", "input3"],
      };
      const result = SessionConfig.safeParse(configWithInputs);
      expect(result.success).toBe(true);
    });

    it("should reject config without required fields", () => {
      const incompleteConfig = {
        resourceId: "local",
      };
      const result = SessionConfig.safeParse(incompleteConfig);
      expect(result.success).toBe(false);
    });
  });

  describe("Checkpoint", () => {
    const validCheckpoint = {
      sessionId: "test-session-id",
      timestamp: Date.now(),
      phase: "running" as const,
      task: "Test task",
    };

    it("should accept valid checkpoint", () => {
      const result = Checkpoint.safeParse(validCheckpoint);
      expect(result.success).toBe(true);
    });

    it("should accept checkpoint with exploreResults", () => {
      const checkpointWithExplore = {
        ...validCheckpoint,
        exploreResults: [
          {
            agentId: "explore-0",
            type: "explore" as const,
            status: "completed" as const,
            messages: [],
            iterations: 5,
            duration: 1000,
          },
        ],
      };
      const result = Checkpoint.safeParse(checkpointWithExplore);
      expect(result.success).toBe(true);
    });

    it("should accept checkpoint with planResult", () => {
      const checkpointWithPlan = {
        ...validCheckpoint,
        phase: "running" as const,
        planResult: {
          agentId: "planner",
          type: "plan" as const,
          status: "completed" as const,
          messages: [],
          iterations: 10,
          duration: 5000,
          finalContent: "Plan completed",
        },
      };
      const result = Checkpoint.safeParse(checkpointWithPlan);
      expect(result.success).toBe(true);
    });

    it("should accept checkpoint with buildResult", () => {
      const checkpointWithBuild = {
        ...validCheckpoint,
        phase: "running" as const,
        buildResult: {
          agentId: "builder",
          type: "build" as const,
          status: "completed" as const,
          messages: [],
          iterations: 20,
          duration: 10000,
          finalContent: "Build completed",
        },
      };
      const result = Checkpoint.safeParse(checkpointWithBuild);
      expect(result.success).toBe(true);
    });

    it("should accept checkpoint with agentStates", () => {
      const checkpointWithStates = {
        ...validCheckpoint,
        agentStates: [
          {
            agentId: "explore-0",
            type: "explore" as const,
            status: "running" as const,
            messages: [{ role: "user", content: "test" }],
            iterationCount: 3,
          },
          {
            agentId: "explore-1",
            type: "explore" as const,
            status: "completed" as const,
            messages: [{ role: "user", content: "test" }],
            iterationCount: 5,
          },
        ],
      };
      const result = Checkpoint.safeParse(checkpointWithStates);
      expect(result.success).toBe(true);
    });

    it("should accept checkpoint for all phases", () => {
      const phases: Array<"idle" | "running" | "completed" | "failed"> = [
        "idle",
        "running",
        "completed",
        "failed",
      ];

      phases.forEach(phase => {
        const checkpoint = { ...validCheckpoint, phase };
        const result = Checkpoint.safeParse(checkpoint);
        expect(result.success).toBe(true);
      });
    });
  });
});
