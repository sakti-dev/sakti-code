import type { MessageWithId } from "@/core/state/stores";
import type { Part } from "@sakti-code/shared/event-types";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

let messagesBySession: Record<string, MessageWithId[]> = {};
let messagesById: Record<string, MessageWithId> = {};
let partsByMessage: Record<string, Part[]> = {};

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
}));

describe("useMessages", () => {
  beforeEach(() => {
    messagesBySession = {};
    messagesById = {};
    partsByMessage = {};
  });

  it("projects messages with parts and derived fields", async () => {
    const user: MessageWithId = {
      id: "u1",
      role: "user",
      sessionID: "s1",
      time: { created: 10 },
    } as MessageWithId;
    const assistant: MessageWithId = {
      id: "a1",
      role: "assistant",
      parentID: "u1",
      sessionID: "s1",
      time: { created: 20, completed: 30 },
    } as MessageWithId;

    messagesBySession.s1 = [user, assistant];
    messagesById.u1 = user;
    messagesById.a1 = assistant;
    partsByMessage.u1 = [{ id: "p1", type: "text", messageID: "u1", text: "hi" }];
    partsByMessage.a1 = [{ id: "p2", type: "text", messageID: "a1", text: "hello" }];

    const { useMessages } = await import("@/core/chat/hooks");

    createRoot(dispose => {
      const hook = useMessages(() => "s1");

      const list = hook.list();
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({
        id: "u1",
        role: "user",
        createdAt: 10,
        sessionId: "s1",
      });
      expect(list[1]).toMatchObject({
        id: "a1",
        role: "assistant",
        parentId: "u1",
        createdAt: 20,
        completedAt: 30,
      });

      expect(hook.count()).toBe(2);
      expect(hook.lastAssistant()?.id).toBe("a1");
      expect(hook.userMessages().map(m => m.id)).toEqual(["u1"]);
      expect(hook.assistantMessages().map(m => m.id)).toEqual(["a1"]);
      expect(hook.get("a1")?.parts).toHaveLength(1);

      dispose();
    });
  });

  it("returns empty list when session is null", async () => {
    const { useMessages } = await import("@/core/chat/hooks");

    createRoot(dispose => {
      const hook = useMessages(() => null);
      expect(hook.list()).toEqual([]);
      expect(hook.count()).toBe(0);
      expect(hook.lastAssistant()).toBeUndefined();
      dispose();
    });
  });
});
