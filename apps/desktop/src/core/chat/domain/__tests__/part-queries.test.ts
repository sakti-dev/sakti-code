/**
 * Part Queries Tests
 */

import {
  getById,
  getByMessage,
  getTextParts,
  getToolCallParts,
} from "@/core/chat/domain/part-queries";
import type { PartState } from "@/core/state/stores/part-store";
import { describe, expect, it } from "vitest";

describe("Part Queries", () => {
  const createState = (): PartState => ({
    byId: {
      "part-1": { type: "text", id: "part-1", messageID: "msg-1", content: { text: "Hello" } },
      "part-2": { type: "tool_call", id: "part-2", messageID: "msg-1", name: "fs.write" },
      "part-3": { type: "text", id: "part-3", messageID: "msg-2", content: { text: "World" } },
    },
    byMessage: {
      "msg-1": ["part-1", "part-2"],
      "msg-2": ["part-3"],
    },
  });

  describe("getByMessage", () => {
    it("returns all parts for a message", () => {
      const state = createState();
      const parts = getByMessage(state, "msg-1");

      expect(parts).toHaveLength(2);
      expect(parts[0].id).toBe("part-1");
      expect(parts[1].id).toBe("part-2");
    });

    it("returns empty array for unknown message", () => {
      const state = createState();
      const parts = getByMessage(state, "unknown");

      expect(parts).toEqual([]);
    });
  });

  describe("getById", () => {
    it("returns part by id", () => {
      const state = createState();
      const part = getById(state, "part-1");

      expect(part?.id).toBe("part-1");
      expect(part?.type).toBe("text");
    });

    it("returns undefined for unknown part", () => {
      const state = createState();
      const part = getById(state, "unknown");

      expect(part).toBeUndefined();
    });
  });

  describe("getTextParts", () => {
    it("returns only text parts", () => {
      const state = createState();
      const parts = getTextParts(state, "msg-1");

      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe("text");
    });
  });

  describe("getToolCallParts", () => {
    it("returns only tool call parts", () => {
      const state = createState();
      const parts = getToolCallParts(state, "msg-1");

      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe("tool_call");
    });
  });
});
