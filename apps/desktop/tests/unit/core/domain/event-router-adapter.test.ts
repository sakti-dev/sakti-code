import { applyEventToStores } from "@/core/chat/domain/event-router-adapter";
import {
  createMessageStore,
  createPartStore,
  createPermissionStore,
  createQuestionStore,
  createSessionStore,
} from "@/core/state/stores";
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
  const [, permissionActions] = createPermissionStore();
  const [, questionActions] = createQuestionStore();
  return { messageActions, partActions, sessionActions, permissionActions, questionActions };
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
    const { messageActions, partActions, sessionActions, permissionActions } = createActions();
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
        sessionActions,
        permissionActions
      );
    } finally {
      window.removeEventListener("ekacode:permission.asked", specificListener as EventListener);
      window.removeEventListener("ekacode:sse-event", globalListener as EventListener);
    }

    expect(specificListener).toHaveBeenCalledTimes(1);
    expect(globalListener).toHaveBeenCalledTimes(1);
    expect(permissionActions.getById("perm-1")).toEqual(
      expect.objectContaining({
        id: "perm-1",
        sessionID: SESSION_ID_1,
        status: "pending",
        toolName: "write",
      })
    );
  });

  it("stores question replies as unknown payloads", async () => {
    const { messageActions, partActions, sessionActions, questionActions } = createActions();

    await applyEventToStores(
      {
        type: "question.asked",
        properties: {
          id: "q-1",
          sessionID: SESSION_ID_1,
          questions: ["Pick one"],
          tool: { messageID: "msg-1", callID: "call-1" },
        },
        eventId: uuidv7(),
        sequence: 1,
        timestamp: Date.now(),
      } as ServerEvent,
      messageActions,
      partActions,
      sessionActions,
      undefined,
      questionActions
    );

    await applyEventToStores(
      {
        type: "question.replied",
        properties: {
          sessionID: SESSION_ID_1,
          requestID: "q-1",
          reply: { selected: "A" },
        },
        eventId: uuidv7(),
        sequence: 2,
        timestamp: Date.now(),
      } as ServerEvent,
      messageActions,
      partActions,
      sessionActions,
      undefined,
      questionActions
    );

    expect(questionActions.getById("q-1")).toEqual(
      expect.objectContaining({
        id: "q-1",
        status: "answered",
        answer: { selected: "A" },
      })
    );
  });

  it("creates missing session from event.sessionID before applying message.updated", async () => {
    const { messageActions, partActions, sessionActions } = createActions();
    const messageId = "019c4da0-fc0b-713c-984e-b2aca339c97d";

    await applyEventToStores(
      {
        type: "message.updated",
        properties: {
          info: {
            id: messageId,
            role: "assistant",
          },
          directory: "/repo",
        },
        sessionID: SESSION_ID_1,
        directory: "/repo",
        eventId: uuidv7(),
        sequence: 1,
        timestamp: Date.now(),
      } as ServerEvent,
      messageActions,
      partActions,
      sessionActions
    );

    expect(sessionActions.getById(SESSION_ID_1)).toEqual({
      sessionID: SESSION_ID_1,
      directory: "/repo",
    });
    expect(messageActions.getById(messageId)).toEqual(
      expect.objectContaining({
        id: messageId,
        sessionID: SESSION_ID_1,
      })
    );
  });

  it("keeps existing parts when message reconciliation is an exact-ID match", async () => {
    const { messageActions, partActions, sessionActions } = createActions();
    const messageId = "019c4da0-fc0b-713c-984e-b2aca339c97e";
    const partId = `${messageId}-text`;

    sessionActions.upsert({ sessionID: SESSION_ID_1, directory: "/repo" });
    messageActions.upsert({
      id: messageId,
      role: "assistant",
      sessionID: SESSION_ID_1,
      metadata: {
        optimistic: true,
        optimisticSource: "useChat",
        correlationKey: "msg:assistant:no-parent:0",
        timestamp: Date.now(),
      },
    });
    partActions.upsert({
      id: partId,
      type: "text",
      messageID: messageId,
      sessionID: SESSION_ID_1,
      text: "streaming",
      metadata: {
        optimistic: true,
        optimisticSource: "useChat",
        correlationKey: `part:${messageId}:text:default`,
        timestamp: Date.now(),
      },
    });

    await applyEventToStores(
      {
        type: "message.updated",
        properties: {
          sessionID: SESSION_ID_1,
          info: {
            id: messageId,
            role: "assistant",
            sessionID: SESSION_ID_1,
          },
        },
        eventId: uuidv7(),
        sequence: 1,
        timestamp: Date.now(),
      } as ServerEvent,
      messageActions,
      partActions,
      sessionActions
    );

    expect(messageActions.getById(messageId)).toBeTruthy();
    expect(partActions.getByMessage(messageId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: partId })])
    );
  });

  it("re-associates parts when canonical message replaces optimistic message by correlation", async () => {
    const { messageActions, partActions, sessionActions } = createActions();
    const userMessageId = "019c4da0-fc0b-713c-984e-b2aca339c97f";
    const optimisticAssistantId = "019c4da0-fc0b-713c-984e-b2aca339c981";
    const canonicalAssistantId = "019c4da0-fc0b-713c-984e-b2aca339c982";
    const partId = `${optimisticAssistantId}-text`;

    sessionActions.upsert({ sessionID: SESSION_ID_1, directory: "/repo" });
    messageActions.upsert({
      id: userMessageId,
      role: "user",
      sessionID: SESSION_ID_1,
    });
    messageActions.upsert({
      id: optimisticAssistantId,
      role: "assistant",
      sessionID: SESSION_ID_1,
      parentID: userMessageId,
      metadata: {
        optimistic: true,
        optimisticSource: "useChat",
        correlationKey: `msg:assistant:${userMessageId}:${Date.now()}`,
        timestamp: Date.now(),
      },
    });
    partActions.upsert({
      id: partId,
      type: "text",
      messageID: optimisticAssistantId,
      sessionID: SESSION_ID_1,
      text: "streaming",
      metadata: {
        optimistic: true,
        optimisticSource: "useChat",
        correlationKey: `part:${optimisticAssistantId}:text:default`,
        timestamp: Date.now(),
      },
    });

    await applyEventToStores(
      {
        type: "message.updated",
        properties: {
          sessionID: SESSION_ID_1,
          info: {
            id: canonicalAssistantId,
            role: "assistant",
            sessionID: SESSION_ID_1,
            parentID: userMessageId,
            time: { created: Date.now() },
          },
        },
        eventId: uuidv7(),
        sequence: 1,
        timestamp: Date.now(),
      } as ServerEvent,
      messageActions,
      partActions,
      sessionActions
    );

    expect(messageActions.getById(optimisticAssistantId)).toBeUndefined();
    expect(messageActions.getById(canonicalAssistantId)).toBeTruthy();
    expect(partActions.getByMessage(optimisticAssistantId)).toHaveLength(0);
    expect(partActions.getByMessage(canonicalAssistantId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: partId })])
    );
  });
});
