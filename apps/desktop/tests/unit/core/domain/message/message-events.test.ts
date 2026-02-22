/**
 * Message Event Handlers Tests
 */

import { handleMessageUpdated } from "@/core/chat/domain/message-events";
import type { MessageActions } from "@/core/state/stores/message-store";
import type { PartActions } from "@/core/state/stores/part-store";
import type { SessionActions } from "@/core/state/stores/session-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Message Event Handlers", () => {
  let mockMessageActions: MessageActions;
  let mockPartActions: PartActions;
  let mockSessionActions: SessionActions;

  beforeEach(() => {
    mockMessageActions = {
      upsert: vi.fn(),
      remove: vi.fn(),
      getBySession: vi.fn(),
      getById: vi.fn(),
      _setSessionValidator: vi.fn(),
      _setOnDelete: vi.fn(),
    };

    mockPartActions = {
      upsert: vi.fn(),
      remove: vi.fn(),
      getByMessage: vi.fn(),
      getById: vi.fn(),
      _setMessageValidator: vi.fn(),
    };

    mockSessionActions = {
      upsert: vi.fn(),
      setStatus: vi.fn(),
      getByDirectory: vi.fn(),
      getById: vi.fn(),
      getStatus: vi.fn(),
      remove: vi.fn(),
      _setOnDelete: vi.fn(),
    };
  });

  describe("handleMessageUpdated", () => {
    it("upserts message with id and info", () => {
      const event = {
        type: "message.updated" as const,
        properties: {
          info: {
            id: "msg-1",
            role: "assistant" as const,
            sessionID: "sess-1",
          },
        },
      };

      handleMessageUpdated(event, {
        messageActions: mockMessageActions,
        partActions: mockPartActions,
        sessionActions: mockSessionActions,
      });

      expect(mockMessageActions.upsert).toHaveBeenCalledWith({
        id: "msg-1",
        role: "assistant",
        sessionID: "sess-1",
      });
    });

    it("logs warning for missing message id", () => {
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const event = {
        type: "message.updated" as const,
        properties: {
          info: {
            role: "assistant" as const,
          },
        },
      };

      handleMessageUpdated(event, {
        messageActions: mockMessageActions,
        partActions: mockPartActions,
        sessionActions: mockSessionActions,
      });

      expect(consoleWarn).toHaveBeenCalledWith("[handleMessageUpdated] Missing message id", event);
      expect(mockMessageActions.upsert).not.toHaveBeenCalled();

      consoleWarn.mockRestore();
    });
  });
});
