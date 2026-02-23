/**
 * Session Event Handlers Tests
 */

import {
  handleServerInstanceDisposed,
  handleSessionCreated,
  handleSessionStatus,
  handleSessionUpdated,
} from "@/core/chat/domain/session-events";
import type { MessageActions, MessageWithId } from "@/core/state/stores/message-store";
import type { PartActions } from "@/core/state/stores/part-store";
import type { SessionActions, SessionInfo } from "@/core/state/stores/session-store";
import type { Part } from "@sakti-code/shared/event-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Session Event Handlers", () => {
  let mockSessionActions: SessionActions;
  let mockMessageActions: MessageActions;
  let mockPartActions: PartActions;

  beforeEach(() => {
    mockSessionActions = {
      upsert: vi.fn(),
      remove: vi.fn(),
      setStatus: vi.fn(),
      getByDirectory: vi.fn(),
      getById: vi.fn(),
      getStatus: vi.fn(),
      _setOnDelete: vi.fn(),
    };

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
  });

  describe("handleSessionCreated", () => {
    it("upserts session with sessionID and directory", () => {
      const event = {
        type: "session.created" as const,
        properties: {
          sessionID: "sess-1",
          directory: "/path/to/project",
        },
      };

      handleSessionCreated(event, {
        sessionActions: mockSessionActions,
        messageActions: mockMessageActions,
        partActions: mockPartActions,
      });

      expect(mockSessionActions.upsert).toHaveBeenCalledWith({
        sessionID: "sess-1",
        directory: "/path/to/project",
      });
    });
  });

  describe("handleSessionUpdated", () => {
    it("sets session status when provided", () => {
      const event = {
        type: "session.updated" as const,
        properties: {
          sessionID: "sess-1",
          status: "running" as const,
        },
      };

      handleSessionUpdated(event, {
        sessionActions: mockSessionActions,
        messageActions: mockMessageActions,
        partActions: mockPartActions,
      });

      expect(mockSessionActions.setStatus).toHaveBeenCalledWith("sess-1", { type: "busy" });
    });
  });

  describe("handleSessionStatus", () => {
    it("sets detailed session status", () => {
      const event = {
        type: "session.status" as const,
        properties: {
          sessionID: "sess-1",
          status: { type: "busy" as const },
        },
      };

      handleSessionStatus(event, {
        sessionActions: mockSessionActions,
        messageActions: mockMessageActions,
        partActions: mockPartActions,
      });

      expect(mockSessionActions.setStatus).toHaveBeenCalledWith("sess-1", {
        type: "busy",
      });
    });

    it("sets retry status with attempt info", () => {
      const event = {
        type: "session.status" as const,
        properties: {
          sessionID: "sess-1",
          status: {
            type: "retry" as const,
            attempt: 3,
            message: "Retrying...",
            next: 5000,
          },
        },
      };

      handleSessionStatus(event, {
        sessionActions: mockSessionActions,
        messageActions: mockMessageActions,
        partActions: mockPartActions,
      });

      expect(mockSessionActions.setStatus).toHaveBeenCalledWith("sess-1", {
        type: "retry",
        attempt: 3,
        message: "Retrying...",
        next: 5000,
      });
    });
  });

  describe("handleServerInstanceDisposed", () => {
    it("removes all messages and parts for directory sessions", () => {
      const mockSessions: SessionInfo[] = [
        { sessionID: "sess-1", directory: "/path" },
        { sessionID: "sess-2", directory: "/path" },
      ];
      const mockMessages1: MessageWithId[] = [
        { id: "msg-1", sessionID: "sess-1", role: "assistant" },
      ];
      const mockMessages2: MessageWithId[] = [
        { id: "msg-2", sessionID: "sess-2", role: "assistant" },
      ];
      const mockParts1: Part[] = [{ id: "part-1", messageID: "msg-1", type: "text" }];
      const mockParts2: Part[] = [{ id: "part-2", messageID: "msg-2", type: "text" }];

      vi.mocked(mockSessionActions.getByDirectory).mockReturnValue(mockSessions);
      vi.mocked(mockMessageActions.getBySession)
        .mockReturnValueOnce(mockMessages1)
        .mockReturnValueOnce(mockMessages2);
      vi.mocked(mockPartActions.getByMessage)
        .mockReturnValueOnce(mockParts1)
        .mockReturnValueOnce(mockParts2);

      const event = {
        type: "server.instance.disposed" as const,
        properties: {
          directory: "/path",
        },
      };

      handleServerInstanceDisposed(event, {
        sessionActions: mockSessionActions,
        messageActions: mockMessageActions,
        partActions: mockPartActions,
      });

      // Verify getByDirectory was called
      expect(mockSessionActions.getByDirectory).toHaveBeenCalledWith("/path");
      // Verify messages were retrieved for each session
      expect(mockMessageActions.getBySession).toHaveBeenCalledWith("sess-1");
      expect(mockMessageActions.getBySession).toHaveBeenCalledWith("sess-2");
      // Verify parts were retrieved for each message
      expect(mockPartActions.getByMessage).toHaveBeenCalledWith("msg-1");
      expect(mockPartActions.getByMessage).toHaveBeenCalledWith("msg-2");
      // Verify parts and messages were removed
      expect(mockPartActions.remove).toHaveBeenCalledWith("part-1", "msg-1");
      expect(mockPartActions.remove).toHaveBeenCalledWith("part-2", "msg-2");
      expect(mockMessageActions.remove).toHaveBeenCalledWith("msg-1");
      expect(mockMessageActions.remove).toHaveBeenCalledWith("msg-2");
    });
  });
});
