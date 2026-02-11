/**
 * Message Event Handlers Tests
 */

import { handleMessageUpdated } from "@ekacode/desktop/core/domain/message/message-events";
import type { MessageActions } from "@ekacode/desktop/core/stores/message-store";
import type { PartActions } from "@ekacode/desktop/core/stores/part-store";
import type { SessionActions } from "@ekacode/desktop/core/stores/session-store";
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
    } as unknown as MessageActions;

    mockPartActions = {
      upsert: vi.fn(),
      remove: vi.fn(),
      getByMessage: vi.fn(),
      getById: vi.fn(),
    } as unknown as PartActions;

    mockSessionActions = {
      upsert: vi.fn(),
      setStatus: vi.fn(),
      getByDirectory: vi.fn(),
      getById: vi.fn(),
      getStatus: vi.fn(),
    } as unknown as SessionActions;
  });

  describe("handleMessageUpdated", () => {
    it("upserts message with id and info", () => {
      const event = {
        type: "message.updated" as const,
        properties: {
          info: {
            id: "msg-1",
            role: "assistant",
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
            role: "assistant",
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
