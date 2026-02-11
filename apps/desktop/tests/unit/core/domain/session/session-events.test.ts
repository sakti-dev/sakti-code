/**
 * Session Event Handlers Tests
 */

import {
  handleServerInstanceDisposed,
  handleSessionCreated,
  handleSessionStatus,
  handleSessionUpdated,
} from "@ekacode/desktop/core/domain/session/session-events";
import type { MessageActions } from "@ekacode/desktop/core/stores/message-store";
import type { PartActions } from "@ekacode/desktop/core/stores/part-store";
import type { SessionActions } from "@ekacode/desktop/core/stores/session-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Session Event Handlers", () => {
  let mockSessionActions: SessionActions;
  let mockMessageActions: MessageActions;
  let mockPartActions: PartActions;

  beforeEach(() => {
    mockSessionActions = {
      upsert: vi.fn(),
      setStatus: vi.fn(),
      getByDirectory: vi.fn(),
      getById: vi.fn(),
      getStatus: vi.fn(),
    } as unknown as SessionActions;

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
          status: "running",
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
          status: { type: "busy" },
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
            type: "retry",
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
      const mockSessions = [
        { sessionID: "sess-1", directory: "/path" },
        { sessionID: "sess-2", directory: "/path" },
      ];
      const mockMessages1 = [{ id: "msg-1", sessionID: "sess-1" }];
      const mockMessages2 = [{ id: "msg-2", sessionID: "sess-2" }];
      const mockParts1 = [{ id: "part-1" }];
      const mockParts2 = [{ id: "part-2" }];

      vi.mocked(mockSessionActions.getByDirectory).mockReturnValue(mockSessions);
      vi.mocked(mockMessageActions.getBySession)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockReturnValueOnce(mockMessages1 as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockReturnValueOnce(mockMessages2 as any);
      vi.mocked(mockPartActions.getByMessage)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockReturnValueOnce(mockParts1 as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockReturnValueOnce(mockParts2 as any);

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
