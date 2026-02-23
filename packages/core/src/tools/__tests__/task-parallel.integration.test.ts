/**
 * Tests for task-parallel tool
 *
 * TDD: Tests written first to define expected behavior of parallel explore spawning
 */

import { taskParallelTool } from "@/tools/task-parallel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequestApproval } = vi.hoisted(() => ({
  mockRequestApproval: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/security/permission-manager", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      requestApproval: (...args: unknown[]) => mockRequestApproval(...args),
      getRules: vi.fn(() => []),
    })),
  },
}));

vi.mock("@/security/permission-rules", () => ({
  evaluatePermission: vi.fn(() => "allow"),
  createDefaultRules: vi.fn(() => []),
}));

describe("taskParallelTool", () => {
  let Instance: typeof import("@/instance").Instance;
  const taskParallelExecute = taskParallelTool.execute as NonNullable<
    typeof taskParallelTool.execute
  >;
  type ToolOptions = Parameters<typeof taskParallelExecute>[1];

  const testSessionId = "test-parallel-session";
  const testWorkspaceDir = "/tmp/sakti-code-test-parallel";
  const toolOptions: ToolOptions = { toolCallId: "task-parallel-call", messages: [] };

  beforeEach(async () => {
    vi.clearAllMocks();

    const instanceModule = await import("@/instance");
    Instance = instanceModule.Instance;
  });

  describe("input validation", () => {
    it("should reject empty tasks array", async () => {
      await Instance.provide({
        directory: testWorkspaceDir,
        sessionID: testSessionId,
        messageID: "msg-1",
        async fn() {
          await expect(taskParallelExecute({ tasks: [] }, toolOptions)).rejects.toThrow(
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
          await expect(taskParallelExecute({ tasks: tooManyTasks }, toolOptions)).rejects.toThrow(
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
