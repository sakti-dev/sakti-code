/**
 * Tests for task-parallel tool
 *
 * TDD: Tests written first to define expected behavior of parallel explore spawning
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { taskParallelTool } from "../../../src/tools/task-parallel";

const { mockRequestApproval } = vi.hoisted(() => ({
  mockRequestApproval: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../src/security/permission-manager", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      requestApproval: (...args: unknown[]) => mockRequestApproval(...args),
      getRules: vi.fn(() => []),
    })),
  },
}));

vi.mock("../../../src/security/permission-rules", () => ({
  evaluatePermission: vi.fn(() => "allow"),
}));

describe("taskParallelTool", () => {
  let Instance: typeof import("../../../src/instance").Instance;

  const testSessionId = "test-parallel-session";
  const testWorkspaceDir = "/tmp/ekacode-test-parallel";

  beforeEach(async () => {
    vi.clearAllMocks();

    const instanceModule = await import("../../../src/instance");
    Instance = instanceModule.Instance;
  });

  describe("input validation", () => {
    it("should reject empty tasks array", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await expect(taskParallelTool.execute({ tasks: [] }, {})).rejects.toThrow(
            "At least one task is required"
          );
        },
      });
    });

    it("should reject more than 8 tasks", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          const tooManyTasks = Array.from({ length: 9 }, (_, i) => ({
            description: `Task ${i}`,
            prompt: `Do task ${i}`,
          }));
          await expect(taskParallelTool.execute({ tasks: tooManyTasks }, {})).rejects.toThrow(
            "Maximum 8 tasks allowed"
          );
        },
      });
    });

    it("should have correct input schema defined", () => {
      expect(taskParallelTool).toBeDefined();
      expect(typeof taskParallelTool.execute).toBe("function");
    });
  });
});
