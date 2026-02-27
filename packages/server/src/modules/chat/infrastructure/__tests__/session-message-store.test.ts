/**
 * Tests for Session Message Store
 *
 * TDD: Test in-memory message/part storage
 *
 * Note: The session-message-store is in-memory and doesn't have a clear function.
 * Tests must use unique sessionIDs to avoid state pollution.
 */

import type { MessageInfo, Part } from "@sakti-code/core/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionStore,
  getSessionMessages,
  removePart,
  upsertMessage,
  upsertPart,
} from "../session-message-store";

type UserMessageInfo = Extract<MessageInfo, { role: "user" }>;
type AssistantMessageInfo = Extract<MessageInfo, { role: "assistant" }>;
type TextPart = Extract<Part, { type: "text" }>;

function createUserMessage(overrides: Partial<UserMessageInfo> = {}): UserMessageInfo {
  return {
    id: "msg-1",
    sessionID: "session-1",
    role: "user",
    time: { created: 1000 },
    ...overrides,
  };
}

function createAssistantMessage(
  overrides: Partial<AssistantMessageInfo> = {}
): AssistantMessageInfo {
  return {
    id: "msg-1",
    sessionID: "session-1",
    role: "assistant",
    time: { created: 1000 },
    ...overrides,
  };
}

function createTextPart(overrides: Partial<TextPart> = {}): TextPart {
  return {
    id: "part-1",
    messageID: "msg-1",
    sessionID: "session-1",
    type: "text",
    text: "Hello",
    ...overrides,
  };
}

function assertTextPart(part: Part): asserts part is TextPart {
  expect(part.type).toBe("text");
}

describe("Session Message Store", () => {
  afterEach(() => {
    clearSessionStore();
  });

  describe("upsertMessage", () => {
    it("should store message in session", () => {
      upsertMessage(createUserMessage());

      const messages = getSessionMessages("session-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].info.id).toBe("msg-1");
    });

    it("should update existing message", () => {
      upsertMessage(createUserMessage());
      upsertMessage(createUserMessage({ time: { created: 2000 } }));

      const messages = getSessionMessages("session-1");
      expect(messages).toHaveLength(1);
    });

    it("should ignore message without sessionID", () => {
      upsertMessage({
        id: "msg-1",
        role: "user",
        time: { created: 1000 },
      } as unknown as MessageInfo);

      const messages = getSessionMessages("unknown-session");
      expect(messages).toHaveLength(0);
    });
  });

  describe("upsertPart", () => {
    beforeEach(() => {
      upsertMessage(createAssistantMessage());
    });

    it("should store part in message", () => {
      upsertPart(createTextPart());

      const messages = getSessionMessages("session-1");
      expect(messages[0].parts).toHaveLength(1);
      const firstPart = messages[0].parts[0];
      assertTextPart(firstPart);
      expect(firstPart.text).toBe("Hello");
    });

    it("should update existing part", () => {
      upsertPart(createTextPart());
      upsertPart(createTextPart({ text: "Hello World" }));

      const messages = getSessionMessages("session-1");
      expect(messages[0].parts).toHaveLength(1);
      const firstPart = messages[0].parts[0];
      assertTextPart(firstPart);
      expect(firstPart.text).toBe("Hello World");
    });

    it("should auto-create message if not exists", () => {
      upsertPart(
        createTextPart({
          messageID: "msg-2",
          text: "Auto-created message",
        })
      );

      const messages = getSessionMessages("session-1");
      expect(messages).toHaveLength(2);
    });

    it("should ignore part without required fields", () => {
      upsertPart({
        id: "part-1",
        sessionID: "session-1",
        type: "text",
        text: "Missing messageID",
      } as unknown as Part);

      const messages = getSessionMessages("session-1");
      expect(messages[0].parts).toHaveLength(0);
    });
  });

  describe("removePart", () => {
    beforeEach(() => {
      upsertMessage(createAssistantMessage());
      upsertPart(createTextPart());
      upsertPart(
        createTextPart({
          id: "part-2",
          text: "World",
        })
      );
    });

    it("should remove part from message", () => {
      removePart({
        sessionID: "session-1",
        messageID: "msg-1",
        partID: "part-1",
      });

      const messages = getSessionMessages("session-1");
      expect(messages[0].parts).toHaveLength(1);
      expect(messages[0].parts[0].id).toBe("part-2");
    });

    it("should do nothing for non-existent session", () => {
      removePart({
        sessionID: "unknown-session",
        messageID: "msg-1",
        partID: "part-1",
      });

      const messages = getSessionMessages("session-1");
      expect(messages[0].parts).toHaveLength(2);
    });
  });

  describe("getSessionMessages", () => {
    it("should return empty array for unknown session", () => {
      const messages = getSessionMessages("unknown-session");
      expect(messages).toEqual([]);
    });

    it("should return messages sorted by created time", () => {
      upsertMessage(createUserMessage({ id: "msg-2", time: { created: 2000 } }));
      upsertMessage(createUserMessage({ id: "msg-1", time: { created: 1000 } }));

      const messages = getSessionMessages("session-1");
      expect(messages[0].info.id).toBe("msg-1");
      expect(messages[1].info.id).toBe("msg-2");
    });

    it("should return parts sorted by id", () => {
      upsertPart(
        createTextPart({
          id: "part-b",
          text: "b",
        })
      );
      upsertPart(
        createTextPart({
          id: "part-a",
          text: "a",
        })
      );

      const messages = getSessionMessages("session-1");
      expect(messages[0].parts[0].id).toBe("part-a");
      expect(messages[0].parts[1].id).toBe("part-b");
    });
  });
});
