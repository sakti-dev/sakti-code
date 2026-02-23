/**
 * Message Store Tests
 */

import {
  createEmptyMessageState,
  createMessageStore,
  type MessageWithId,
} from "@/core/state/stores";
import { describe, expect, it } from "vitest";

describe("MessageStore", () => {
  describe("createEmptyMessageState", () => {
    it("creates empty state", () => {
      const state = createEmptyMessageState();
      expect(state.byId).toEqual({});
      expect(state.bySession).toEqual({});
    });
  });

  describe("upsert", () => {
    it("adds new message", () => {
      const [state, actions] = createMessageStore();
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId;

      actions.upsert(message);

      expect(state.byId["msg-1"]).toEqual(message);
      expect(state.bySession["session-1"]).toContain("msg-1");
    });

    it("updates existing message", () => {
      const [state, actions] = createMessageStore();
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId;

      actions.upsert(message);
      actions.upsert({ ...message, role: "assistant" as const });

      expect(state.byId["msg-1"].role).toBe("assistant");
      expect(state.bySession["session-1"]).toHaveLength(1);
    });

    it("does not duplicate message in session order", () => {
      const [state, actions] = createMessageStore();
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId;

      actions.upsert(message);
      actions.upsert(message);

      expect(state.bySession["session-1"]).toEqual(["msg-1"]);
    });
  });

  describe("remove", () => {
    it("removes message from byId", () => {
      const [state, actions] = createMessageStore();
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId;

      actions.upsert(message);
      actions.remove("msg-1");

      expect(state.byId["msg-1"]).toBeUndefined();
    });

    it("removes message from session order", () => {
      const [state, actions] = createMessageStore();
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId;

      actions.upsert(message);
      actions.remove("msg-1");

      expect(state.bySession["session-1"]).toEqual([]);
    });

    it("handles removing non-existent message", () => {
      const [, actions] = createMessageStore();
      // Should not throw
      actions.remove("non-existent");
    });
  });

  describe("getBySession", () => {
    it("returns messages for session", () => {
      const [, actions] = createMessageStore();
      actions.upsert({ id: "msg-1", role: "user", sessionID: "s1" } as MessageWithId);
      actions.upsert({ id: "msg-2", role: "assistant", sessionID: "s1" } as MessageWithId);
      actions.upsert({ id: "msg-3", role: "user", sessionID: "s2" } as MessageWithId);

      const s1Messages = actions.getBySession("s1");
      expect(s1Messages).toHaveLength(2);
      expect(s1Messages.map(m => m.id)).toEqual(["msg-1", "msg-2"]);
    });

    it("returns empty array for session with no messages", () => {
      const [, actions] = createMessageStore();
      const messages = actions.getBySession("non-existent");
      expect(messages).toEqual([]);
    });

    it("preserves message order", () => {
      const [, actions] = createMessageStore();
      actions.upsert({ id: "msg-1", role: "user", sessionID: "s1" } as MessageWithId);
      actions.upsert({ id: "msg-2", role: "assistant", sessionID: "s1" } as MessageWithId);
      actions.upsert({ id: "msg-3", role: "user", sessionID: "s1" } as MessageWithId);

      const s1Messages = actions.getBySession("s1");
      expect(s1Messages.map(m => m.id)).toEqual(["msg-1", "msg-2", "msg-3"]);
    });
  });

  describe("getById", () => {
    it("returns message by id", () => {
      const [, actions] = createMessageStore();
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId;

      actions.upsert(message);
      const retrieved = actions.getById("msg-1");

      expect(retrieved).toEqual(message);
    });

    it("returns undefined for non-existent message", () => {
      const [, actions] = createMessageStore();
      const retrieved = actions.getById("non-existent");
      expect(retrieved).toBeUndefined();
    });
  });
});
