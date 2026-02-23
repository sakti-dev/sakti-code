/**
 * Event Router Tests
 */

import { createEventRouter } from "@/core/chat/domain/event-router";
import type { MessageActions } from "@/core/state/stores/message-store";
import type { PartActions } from "@/core/state/stores/part-store";
import type { SessionActions } from "@/core/state/stores/session-store";
import type { AllServerEvents, EventType } from "@sakti-code/shared/event-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

function mkEvent<T extends EventType>(
  type: T,
  properties: Extract<AllServerEvents, { type: T }>["properties"]
): Extract<AllServerEvents, { type: T }> {
  return {
    type,
    properties,
    eventId: `evt-${type}-${Date.now()}`,
    sequence: 1,
    timestamp: Date.now(),
  } as Extract<AllServerEvents, { type: T }>;
}

describe("Event Router", () => {
  let mockMessageActions: MessageActions;
  let mockPartActions: PartActions;
  let mockSessionActions: SessionActions;
  let router: ReturnType<typeof createEventRouter>;

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

    router = createEventRouter({
      messageActions: mockMessageActions,
      partActions: mockPartActions,
      sessionActions: mockSessionActions,
    });
  });

  describe("handle", () => {
    it("routes message.updated to message handler", () => {
      const event = mkEvent("message.updated", {
        info: { id: "msg-1", role: "assistant", sessionID: "sess-1" },
      });

      router.handle(event);

      expect(mockMessageActions.upsert).toHaveBeenCalledWith({
        id: "msg-1",
        role: "assistant",
        sessionID: "sess-1",
      });
    });

    it("routes message.part.updated to part handler", () => {
      const event = mkEvent("message.part.updated", {
        part: { type: "text", id: "part-1", messageID: "msg-1" },
      });

      router.handle(event);

      expect(mockPartActions.upsert).toHaveBeenCalledWith({
        type: "text",
        id: "part-1",
        messageID: "msg-1",
      });
    });

    it("routes session.created to session handler", () => {
      const event = mkEvent("session.created", {
        sessionID: "sess-1",
        directory: "/path",
      });

      router.handle(event);

      expect(mockSessionActions.upsert).toHaveBeenCalledWith({
        sessionID: "sess-1",
        directory: "/path",
      });
    });

    it("ignores server.connected event", () => {
      const event = mkEvent("server.connected", {});

      router.handle(event);

      expect(mockMessageActions.upsert).not.toHaveBeenCalled();
      expect(mockPartActions.upsert).not.toHaveBeenCalled();
      expect(mockSessionActions.upsert).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const event = mkEvent("message.updated", {
        info: { id: "msg-1", role: "assistant" },
      });

      // Make upsert throw an error
      vi.mocked(mockMessageActions.upsert).mockImplementationOnce(() => {
        throw new Error("Test error");
      });

      router.handle(event);

      expect(consoleError).toHaveBeenCalledWith(
        "[EventRouter] Error handling message.updated:",
        expect.any(Error)
      );

      consoleError.mockRestore();
    });
  });

  describe("handleBatch", () => {
    it("handles multiple events with batching", () => {
      const events: AllServerEvents[] = [
        mkEvent("session.created", { sessionID: "sess-1", directory: "/path" }),
        mkEvent("message.updated", {
          info: { id: "msg-1", role: "assistant", sessionID: "sess-1" },
        }),
        mkEvent("message.part.updated", {
          part: { type: "text", id: "part-1", messageID: "msg-1" },
        }),
      ];

      router.handleBatch(events);

      expect(mockSessionActions.upsert).toHaveBeenCalledWith({
        sessionID: "sess-1",
        directory: "/path",
      });
      expect(mockMessageActions.upsert).toHaveBeenCalledWith({
        id: "msg-1",
        role: "assistant",
        sessionID: "sess-1",
      });
      expect(mockPartActions.upsert).toHaveBeenCalledWith({
        type: "text",
        id: "part-1",
        messageID: "msg-1",
      });
    });
  });
});
