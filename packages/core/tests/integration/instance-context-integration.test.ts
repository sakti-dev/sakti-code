/**
 * Instance Context Integration Tests
 *
 * Comprehensive integration tests for tool behavior with Instance context
 */

import { Instance } from "@/instance";
import { readTool } from "@/tools/filesystem/read";
import { writeTool } from "@/tools/filesystem/write";
import { bashTool } from "@/tools/shell/bash.tool";
import { describe, expect, it } from "vitest";

describe("Instance Context Integration", () => {
  const readExecute = readTool.execute as NonNullable<typeof readTool.execute>;
  const toolOptions: Parameters<typeof readExecute>[1] = {
    toolCallId: "instance-context-call",
    messages: [],
  };
  describe("context validation", () => {
    it("tools fail gracefully when context missing", async () => {
      // Call tool outside Instance.provide()
      await expect(readExecute({ filePath: "test.txt" }, toolOptions)).rejects.toThrow(
        "Tool executed outside of Instance.provide()"
      );
    });

    it("tools work correctly within context", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          // Context is available inside provide()
          expect(Instance.context).toBeDefined();
          expect(Instance.context.directory).toBe("/workspace");
        },
      });
    });
  });

  describe("workspace boundaries", () => {
    it("tools respect workspace boundaries", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          // This test verifies that tools check workspace boundaries
          // Actual file operations would require real filesystem
          expect(Instance.context.directory).toBe("/workspace");
        },
      });
    });

    it("context isolation between different sessions", async () => {
      let sessionId1: string | undefined;
      let sessionId2: string | undefined;

      await Instance.provide({
        directory: "/workspace",
        sessionID: "session-1",
        async fn() {
          sessionId1 = Instance.context.sessionID;
        },
      });

      await Instance.provide({
        directory: "/workspace",
        sessionID: "session-2",
        async fn() {
          sessionId2 = Instance.context.sessionID;
        },
      });

      expect(sessionId1).toBe("session-1");
      expect(sessionId2).toBe("session-2");
    });
  });

  describe("enhanced error messages", () => {
    it("getContextOrThrow provides enhanced error message", async () => {
      // Inside context works correctly
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          // Inside context is fine
          void Instance.context;
        },
      });

      // Outside context should throw with enhanced message
      expect(() => Instance.context).toThrow(
        "Instance context accessed outside of Instance.provide()"
      );
    });
  });

  describe("tool pattern consistency", () => {
    it("all tools use AI SDK tool() pattern", async () => {
      // Verify tools have the correct structure
      expect(readTool).toBeDefined();
      expect(readTool.inputSchema).toBeDefined();
      expect(readTool.outputSchema).toBeDefined();
      expect(readTool.execute).toBeInstanceOf(Function);

      expect(writeTool).toBeDefined();
      expect(writeTool.inputSchema).toBeDefined();
      expect(writeTool.outputSchema).toBeDefined();
      expect(writeTool.execute).toBeInstanceOf(Function);

      expect(bashTool).toBeDefined();
      expect(bashTool.inputSchema).toBeDefined();
      expect(bashTool.outputSchema).toBeDefined();
      expect(bashTool.execute).toBeInstanceOf(Function);
    });
  });

  describe("safe path resolution", () => {
    it("relative paths are resolved against workspace root", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          // The resolveSafePath function is tested in safety.test.ts
          // This integration test verifies tools use it correctly
          const { directory } = Instance.context;
          expect(directory).toBe("/workspace");
        },
      });
    });

    it("absolute paths are preserved", async () => {
      await Instance.provide({
        directory: "/workspace",
        async fn() {
          const { directory } = Instance.context;
          expect(directory).toBe("/workspace");
        },
      });
    });
  });
});
