/**
 * useSessionTurns Hook Tests
 *
 * Tests for the reactive hook that projects ChatTurn model from stores.
 */

import type { MessageWithId } from "@/core/state/stores/message-store";
import type { PermissionRequest } from "@/core/state/stores/permission-store";
import type { QuestionRequest } from "@/core/state/stores/question-store";
import type { Part } from "@sakti-code/shared/event-types";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPendingPermissionRequest,
  createPendingQuestionRequest,
} from "../../../../fixtures/permission-question-fixtures";

let messagesBySession: Record<string, MessageWithId[]> = {};
let messagesById: Record<string, MessageWithId> = {};
let partsByMessage: Record<string, Part[]> = {};
let permissionsBySession: Record<string, PermissionRequest[]> = {};
let questionsBySession: Record<string, QuestionRequest[]> = {};
let sessionStatus: Record<string, { type: "idle" } | { type: "busy" }> = {};

vi.mock("@/core/state/providers/store-provider", () => ({
  useMessageStore: () => [
    {},
    {
      getBySession: (sessionId: string) => messagesBySession[sessionId] ?? [],
      getById: (id: string) => messagesById[id],
      upsert: () => {},
      remove: () => {},
    },
  ],
  usePartStore: () => [
    {},
    {
      getByMessage: (messageId: string) => partsByMessage[messageId] ?? [],
      getById: () => undefined,
      upsert: () => {},
      remove: () => {},
    },
  ],
  useSessionStore: () => [
    {},
    {
      getStatus: (sessionId: string) => sessionStatus[sessionId],
      upsert: () => {},
    },
  ],
  usePermissionStore: () => [
    {},
    {
      getBySession: (sessionId: string) => permissionsBySession[sessionId] ?? [],
      add: () => {},
      resolve: () => {},
      approve: () => {},
      deny: () => {},
      getById: () => undefined,
      getPending: () => [],
      remove: () => {},
      clearResolved: () => {},
    },
  ],
  useQuestionStore: () => [
    {},
    {
      getBySession: (sessionId: string) => questionsBySession[sessionId] ?? [],
      add: () => {},
      answer: () => {},
      getById: () => undefined,
      getPending: () => [],
      remove: () => {},
      clearAnswered: () => {},
    },
  ],
}));

describe("useSessionTurns", () => {
  beforeEach(() => {
    messagesBySession = {};
    messagesById = {};
    partsByMessage = {};
    permissionsBySession = {};
    questionsBySession = {};
    sessionStatus = {};
  });

  it("returns empty array when session is null", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    createRoot(dispose => {
      const turns = useSessionTurns(() => null);
      expect(turns()).toEqual([]);
      dispose();
    });
  });

  it("returns empty array when no messages", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    messagesBySession["s1"] = [];
    sessionStatus["s1"] = { type: "idle" };

    createRoot(dispose => {
      const turns = useSessionTurns(() => "s1");
      expect(turns()).toEqual([]);
      dispose();
    });
  });

  it("returns reactive turns from stores", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    const userMessage: MessageWithId = {
      id: "u1",
      role: "user",
      sessionID: "s1",
      time: { created: Date.now() },
    } as MessageWithId;

    const assistantMessage: MessageWithId = {
      id: "a1",
      role: "assistant",
      parentID: "u1",
      sessionID: "s1",
      time: { created: Date.now() + 100 },
    } as MessageWithId;

    messagesBySession["s1"] = [userMessage, assistantMessage];
    messagesById["u1"] = userMessage;
    messagesById["a1"] = assistantMessage;
    partsByMessage["u1"] = [{ id: "p1", type: "text", messageID: "u1", text: "Hello" }];
    partsByMessage["a1"] = [{ id: "p2", type: "text", messageID: "a1", text: "Hi there!" }];
    sessionStatus["s1"] = { type: "idle" };

    createRoot(dispose => {
      const turns = useSessionTurns(() => "s1");

      expect(turns()).toHaveLength(1);
      expect(turns()[0].userMessage.id).toBe("u1");
      expect(turns()[0].assistantMessages).toHaveLength(1);
      expect(turns()[0].assistantMessages[0].id).toBe("a1");

      dispose();
    });
  });

  it("correctly identifies active turn", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    const userMessage: MessageWithId = {
      id: "u1",
      role: "user",
      sessionID: "s1",
      time: { created: Date.now() },
    } as MessageWithId;

    messagesBySession["s1"] = [userMessage];
    messagesById["u1"] = userMessage;
    partsByMessage["u1"] = [{ id: "p1", type: "text", messageID: "u1", text: "Hello" }];
    sessionStatus["s1"] = { type: "busy" };

    createRoot(dispose => {
      const turns = useSessionTurns(() => "s1");

      expect(turns()[0].isActiveTurn).toBe(true);
      expect(turns()[0].working).toBe(true);

      dispose();
    });
  });

  it("handles multiple turns", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    const user1: MessageWithId = {
      id: "u1",
      role: "user",
      sessionID: "s1",
      time: { created: 1000 },
    } as MessageWithId;

    const assistant1: MessageWithId = {
      id: "a1",
      role: "assistant",
      parentID: "u1",
      sessionID: "s1",
      time: { created: 2000 },
    } as MessageWithId;

    const user2: MessageWithId = {
      id: "u2",
      role: "user",
      sessionID: "s1",
      time: { created: 3000 },
    } as MessageWithId;

    const assistant2: MessageWithId = {
      id: "a2",
      role: "assistant",
      parentID: "u2",
      sessionID: "s1",
      time: { created: 4000 },
    } as MessageWithId;

    messagesBySession["s1"] = [user1, assistant1, user2, assistant2];
    messagesById["u1"] = user1;
    messagesById["a1"] = assistant1;
    messagesById["u2"] = user2;
    messagesById["a2"] = assistant2;
    partsByMessage["u1"] = [{ id: "p1", type: "text", messageID: "u1", text: "First" }];
    partsByMessage["a1"] = [{ id: "p2", type: "text", messageID: "a1", text: "Response 1" }];
    partsByMessage["u2"] = [{ id: "p3", type: "text", messageID: "u2", text: "Second" }];
    partsByMessage["a2"] = [{ id: "p4", type: "text", messageID: "a2", text: "Response 2" }];
    sessionStatus["s1"] = { type: "idle" };

    createRoot(dispose => {
      const turns = useSessionTurns(() => "s1");

      expect(turns()).toHaveLength(2);
      expect(turns()[0].isActiveTurn).toBe(false);
      expect(turns()[1].isActiveTurn).toBe(true);

      dispose();
    });
  });

  it("extracts tool parts", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    const userMessage: MessageWithId = {
      id: "u1",
      role: "user",
      sessionID: "s1",
      time: { created: Date.now() },
    } as MessageWithId;

    const assistantMessage: MessageWithId = {
      id: "a1",
      role: "assistant",
      parentID: "u1",
      sessionID: "s1",
      time: { created: Date.now() + 100 },
    } as MessageWithId;

    messagesBySession["s1"] = [userMessage, assistantMessage];
    messagesById["u1"] = userMessage;
    messagesById["a1"] = assistantMessage;
    partsByMessage["u1"] = [{ id: "p1", type: "text", messageID: "u1", text: "Hello" }];
    partsByMessage["a1"] = [
      { id: "p2", type: "tool", messageID: "a1", tool: "read" } as Part,
      { id: "p3", type: "text", messageID: "a1", text: "Result" },
    ];
    sessionStatus["s1"] = { type: "idle" };

    createRoot(dispose => {
      const turns = useSessionTurns(() => "s1");

      expect(turns()[0].toolParts).toHaveLength(1);
      expect(turns()[0].toolParts[0].type).toBe("tool");

      dispose();
    });
  });

  it("includes permission and question requests from unified stores", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    const userMessage: MessageWithId = {
      id: "u1",
      role: "user",
      sessionID: "s1",
      time: { created: Date.now() },
    } as MessageWithId;

    const assistantMessage: MessageWithId = {
      id: "a1",
      role: "assistant",
      parentID: "u1",
      sessionID: "s1",
      time: { created: Date.now() + 100 },
    } as MessageWithId;

    messagesBySession["s1"] = [userMessage, assistantMessage];
    messagesById["u1"] = userMessage;
    messagesById["a1"] = assistantMessage;
    sessionStatus["s1"] = { type: "busy" };
    permissionsBySession["s1"] = [
      createPendingPermissionRequest({
        id: "perm-1",
        sessionID: "s1",
        messageID: "a1",
        toolName: "bash",
        args: { command: "npm run build" },
      }),
    ];
    questionsBySession["s1"] = [
      createPendingQuestionRequest({
        id: "question-1",
        sessionID: "s1",
        messageID: "a1",
        question: "Continue?",
      }),
    ];

    createRoot(dispose => {
      const turns = useSessionTurns(() => "s1");

      expect(turns()).toHaveLength(1);
      expect(turns()[0].permissionParts).toHaveLength(1);
      expect(turns()[0].questionParts).toHaveLength(1);
      expect(turns()[0].statusLabel).toBe("Waiting for input");

      dispose();
    });
  });

  it("recomputes turns when session accessor changes and picks latest store data", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    const userMessage: MessageWithId = {
      id: "u1",
      role: "user",
      sessionID: "s1",
      time: { created: 1000 },
    } as MessageWithId;
    const assistantMessage: MessageWithId = {
      id: "a1",
      role: "assistant",
      parentID: "u1",
      sessionID: "s1",
      time: { created: 1100 },
    } as MessageWithId;

    messagesBySession["s1"] = [userMessage];
    partsByMessage["u1"] = [{ id: "p1", type: "text", messageID: "u1", text: "Initial prompt" }];
    sessionStatus["s1"] = { type: "busy" };

    createRoot(dispose => {
      const [tick, setTick] = createSignal(0);
      const turns = useSessionTurns(() => {
        tick();
        return "s1";
      });

      expect(turns()).toHaveLength(1);
      expect(turns()[0].assistantMessages).toHaveLength(0);

      messagesBySession["s1"] = [userMessage, assistantMessage];
      partsByMessage["a1"] = [{ id: "p2", type: "text", messageID: "a1", text: "Now updated" }];
      sessionStatus["s1"] = { type: "idle" };

      setTick(prev => prev + 1);

      expect(turns()).toHaveLength(1);
      expect(turns()[0].assistantMessages).toHaveLength(1);
      expect(turns()[0].finalTextPart?.type).toBe("text");

      dispose();
    });
  });

  it("reuses unchanged turn references when only one turn changes", async () => {
    const { useSessionTurns } = await import("@/core/chat/hooks/use-session-turns");

    const user1: MessageWithId = {
      id: "u1",
      role: "user",
      sessionID: "s1",
      time: { created: 1000 },
    } as MessageWithId;
    const assistant1: MessageWithId = {
      id: "a1",
      role: "assistant",
      parentID: "u1",
      sessionID: "s1",
      time: { created: 1100 },
    } as MessageWithId;
    const user2: MessageWithId = {
      id: "u2",
      role: "user",
      sessionID: "s1",
      time: { created: 2000 },
    } as MessageWithId;
    const assistant2: MessageWithId = {
      id: "a2",
      role: "assistant",
      parentID: "u2",
      sessionID: "s1",
      time: { created: 2100 },
    } as MessageWithId;

    messagesBySession["s1"] = [user1, assistant1, user2, assistant2];
    partsByMessage["u1"] = [{ id: "u1-text", type: "text", messageID: "u1", text: "first q" }];
    partsByMessage["a1"] = [{ id: "a1-text", type: "text", messageID: "a1", text: "first a" }];
    partsByMessage["u2"] = [{ id: "u2-text", type: "text", messageID: "u2", text: "second q" }];
    partsByMessage["a2"] = [{ id: "a2-text", type: "text", messageID: "a2", text: "second a" }];
    sessionStatus["s1"] = { type: "idle" };

    createRoot(dispose => {
      const [tick, setTick] = createSignal(0);
      const turns = useSessionTurns(() => {
        tick();
        return "s1";
      });

      const initial = turns();
      expect(initial).toHaveLength(2);

      partsByMessage["a2"] = [{ id: "a2-text", type: "text", messageID: "a2", text: "updated" }];
      setTick(prev => prev + 1);

      const next = turns();
      expect(next).toHaveLength(2);
      expect(next[0]).toBe(initial[0]);
      expect(next[1]).not.toBe(initial[1]);

      dispose();
    });
  });
});
