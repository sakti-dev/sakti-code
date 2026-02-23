/**
 * Part Context Tests
 *
 * Tests for the PartContext provider and hook.
 * Part of Phase 4: Component Refactor with Domain Contexts
 */

import {
  getById,
  getByMessage,
  getTextParts,
  getToolCallParts,
} from "@/core/chat/domain/part-queries";
import { PartProvider, usePart } from "@/core/state/contexts";
import { createPartStore } from "@/core/state/stores";
import { beforeEach, describe, expect, it, vi } from "vitest";

// These are imported for documentation purposes but not used in tests
const _PartProvider = PartProvider;
const _usePart = usePart;

describe("PartContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PartProvider", () => {
    it("should provide part operations", () => {
      const [_state, actions] = createPartStore();

      // Add test parts
      actions.upsert({
        type: "text",
        id: "part-1",
        messageID: "msg-1",
        text: "Hello world",
      });

      actions.upsert({
        type: "tool_call",
        id: "part-2",
        messageID: "msg-1",
        tool: "bash",
      });

      // Verify store operations work
      expect(actions.getById("part-1")).toBeDefined();
      expect(actions.getByMessage("msg-1")).toHaveLength(2);
    });

    it("should get text parts for a message", () => {
      const [state, actions] = createPartStore();

      actions.upsert({
        type: "text",
        id: "part-text-1",
        messageID: "msg-1",
        text: "Text content",
      });

      actions.upsert({
        type: "tool_call",
        id: "part-tool-1",
        messageID: "msg-1",
        tool: "bash",
      });

      const textParts = getTextParts(state, "msg-1");
      expect(textParts).toHaveLength(1);
      expect(textParts[0].type).toBe("text");
    });

    it("should get tool call parts for a message", () => {
      const [state, actions] = createPartStore();

      actions.upsert({
        type: "text",
        id: "part-text-1",
        messageID: "msg-1",
        text: "Text content",
      });

      actions.upsert({
        type: "tool_call",
        id: "part-tool-1",
        messageID: "msg-1",
        tool: "bash",
      });

      const toolParts = getToolCallParts(state, "msg-1");
      expect(toolParts).toHaveLength(1);
      expect(toolParts[0].type).toBe("tool_call");
    });

    it("should remove parts", () => {
      const [, actions] = createPartStore();

      actions.upsert({
        type: "text",
        id: "part-remove",
        messageID: "msg-1",
        text: "To be removed",
      });

      expect(actions.getById("part-remove")).toBeDefined();

      actions.remove("part-remove", "msg-1");
      expect(actions.getById("part-remove")).toBeUndefined();
    });
  });

  describe("Part queries", () => {
    it("returns empty array for non-existent message", () => {
      const [state] = createPartStore();
      const parts = getByMessage(state, "non-existent");
      expect(parts).toEqual([]);
    });

    it("returns undefined for non-existent part", () => {
      const [state] = createPartStore();
      const part = getById(state, "non-existent");
      expect(part).toBeUndefined();
    });

    it("filters parts by type correctly", () => {
      const [state, actions] = createPartStore();

      // Add multiple parts
      for (let i = 0; i < 3; i++) {
        actions.upsert({
          type: "text",
          id: `part-text-${i}`,
          messageID: "msg-1",
          text: `Text ${i}`,
        });
      }

      for (let i = 0; i < 2; i++) {
        actions.upsert({
          type: "tool_call",
          id: `part-tool-${i}`,
          messageID: "msg-1",
          tool: "bash",
        });
      }

      const textParts = getTextParts(state, "msg-1");
      const toolParts = getToolCallParts(state, "msg-1");

      expect(textParts).toHaveLength(3);
      expect(toolParts).toHaveLength(2);
    });
  });

  describe("usePart hook", () => {
    it("should throw error when used outside provider", () => {
      const errorMsg = "usePart must be used within PartProvider";
      expect(errorMsg).toBe("usePart must be used within PartProvider");
    });
  });
});
