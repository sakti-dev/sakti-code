import { applyEventToStores } from "@ekacode/desktop/core/domain/event-router-adapter";
import {
  createMessageStore,
  createPartStore,
  createSessionStore,
} from "@ekacode/desktop/core/stores";
import type { ServerEvent } from "@ekacode/shared/event-types";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it, vi } from "vitest";

// Valid UUIDv7 session IDs for testing
const SESSION_ID_1 = "019c4da0-fc0b-713c-984e-b2aca339c97b";
const SESSION_ID_2 = "019c4da0-fc0b-713c-984e-b2aca339c97c";

function createActions() {
  const [, messageActions] = createMessageStore();
  const [, partActions] = createPartStore();
  const [, sessionActions] = createSessionStore();
  return { messageActions, partActions, sessionActions };
}

describe("event-router-adapter", () => {
  it("updates session status from session.status events", async () => {
    const { messageActions, partActions, sessionActions } = createActions();

    await applyEventToStores(
      {
        type: "session.status",
        properties: {
          sessionID: SESSION_ID_1,
          status: { type: "busy" },
        },
        eventId: uuidv7(),
        sequence: 1,
        timestamp: Date.now(),
      } as ServerEvent,
      messageActions,
      partActions,
      sessionActions
    );

    expect(sessionActions.getStatus(SESSION_ID_1)).toEqual({ type: "busy" });
  });

  it("maps session.updated string status into structured status", async () => {
    const { messageActions, partActions, sessionActions } = createActions();

    await applyEventToStores(
      {
        type: "session.updated",
        properties: {
          sessionID: SESSION_ID_2,
          directory: "/repo",
          status: "running",
        },
        eventId: uuidv7(),
        sequence: 1,
        timestamp: Date.now(),
      } as ServerEvent,
      messageActions,
      partActions,
      sessionActions
    );

    expect(sessionActions.getById(SESSION_ID_2)).toEqual({
      sessionID: SESSION_ID_2,
      directory: "/repo",
    });
    expect(sessionActions.getStatus(SESSION_ID_2)).toEqual({ type: "busy" });
  });

  it("forwards permission events to the window event channel", async () => {
    const { messageActions, partActions, sessionActions } = createActions();
    const specificListener = vi.fn();
    const globalListener = vi.fn();

    window.addEventListener("ekacode:permission.asked", specificListener as EventListener);
    window.addEventListener("ekacode:sse-event", globalListener as EventListener);

    try {
      await applyEventToStores(
        {
          type: "permission.asked",
          properties: {
            id: "perm-1",
            sessionID: SESSION_ID_1,
            permission: "write",
            patterns: ["*.ts"],
            always: [],
          },
          eventId: uuidv7(),
          sequence: 1,
          timestamp: Date.now(),
        } as ServerEvent,
        messageActions,
        partActions,
        sessionActions
      );
    } finally {
      window.removeEventListener("ekacode:permission.asked", specificListener as EventListener);
      window.removeEventListener("ekacode:sse-event", globalListener as EventListener);
    }

    expect(specificListener).toHaveBeenCalledTimes(1);
    expect(globalListener).toHaveBeenCalledTimes(1);
  });
});
