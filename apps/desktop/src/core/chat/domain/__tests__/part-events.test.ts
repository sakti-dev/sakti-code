/**
 * Part Event Handlers Tests
 */

import { handlePartRemoved, handlePartUpdated } from "@/core/chat/domain/part-events";
import type { MessageActions } from "@/core/state/stores/message-store";
import type { PartActions } from "@/core/state/stores/part-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Part Event Handlers", () => {
  let mockPartActions: PartActions;
  let mockMessageActions: MessageActions;

  beforeEach(() => {
    mockPartActions = {
      upsert: vi.fn(),
      remove: vi.fn(),
      getByMessage: vi.fn(),
      getById: vi.fn(),
    } as unknown as PartActions;

    mockMessageActions = {
      upsert: vi.fn(),
      remove: vi.fn(),
      getBySession: vi.fn(),
      getById: vi.fn(),
    } as unknown as MessageActions;
  });

  describe("handlePartUpdated", () => {
    it("upserts part with id and messageID", () => {
      const event = {
        type: "message.part.updated" as const,
        properties: {
          part: {
            type: "text",
            id: "part-1",
            messageID: "msg-1",
            content: { text: "Hello" },
          },
        },
      };

      handlePartUpdated(event, {
        partActions: mockPartActions,
        messageActions: mockMessageActions,
      });

      expect(mockPartActions.upsert).toHaveBeenCalledWith({
        type: "text",
        id: "part-1",
        messageID: "msg-1",
        content: { text: "Hello" },
      });
    });

    it("logs warning for missing required fields", () => {
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const event = {
        type: "message.part.updated" as const,
        properties: {
          part: {
            type: "text",
            content: { text: "Hello" },
          },
        },
      };

      handlePartUpdated(event, {
        partActions: mockPartActions,
        messageActions: mockMessageActions,
      });

      expect(consoleWarn).toHaveBeenCalledWith(
        "[handlePartUpdated] Missing required fields",
        event
      );
      expect(mockPartActions.upsert).not.toHaveBeenCalled();

      consoleWarn.mockRestore();
    });
  });

  describe("handlePartRemoved", () => {
    it("removes part from store", () => {
      const event = {
        type: "message.part.removed" as const,
        properties: {
          partID: "part-1",
          messageID: "msg-1",
          sessionID: "sess-1",
        },
      };

      handlePartRemoved(event, {
        partActions: mockPartActions,
        messageActions: mockMessageActions,
      });

      expect(mockPartActions.remove).toHaveBeenCalledWith("part-1", "msg-1");
    });
  });
});
