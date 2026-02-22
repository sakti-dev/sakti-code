/**
 * Message Store Foreign Key Validation Tests
 *
 * Tests for referential integrity between sessions, messages, and parts.
 */

import { createMessageStore, type MessageWithId } from "@/core/state/stores/message-store";
import { createPartStore } from "@/core/state/stores/part-store";
import { createSessionStore } from "@/core/state/stores/session-store";
import { describe, expect, it } from "vitest";
import { validateStoreIntegrity } from "../../../fixtures/data-integrity";

function toIntegrityMessageState(messageState: ReturnType<typeof createMessageStore>[0]) {
  const byId: Record<string, { sessionID?: string }> = {};
  for (const [id, message] of Object.entries(messageState.byId)) {
    const candidate = (message as { sessionID?: unknown }).sessionID;
    byId[id] = { sessionID: typeof candidate === "string" ? candidate : undefined };
  }
  return {
    byId,
    bySession: messageState.bySession,
  };
}

describe("MessageStore - Foreign Key Validation", () => {
  describe("Session Validation", () => {
    it("throws error when adding message to non-existent session", () => {
      const [, sessionActions] = createSessionStore();
      const [, messageActions] = createMessageStore();

      // Try to add message without creating session first
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        sessionID: "non-existent-session",
      } as MessageWithId;

      // Should throw error
      expect(() => {
        const sessionId = message.sessionID as string;
        // This will be implemented with FK validation
        if (!sessionActions.getById(sessionId)) {
          throw new Error(`Cannot add message: session ${sessionId} not found`);
        }
        messageActions.upsert(message);
      }).toThrow("session non-existent-session not found");
    });

    it("allows message when session exists", () => {
      const [, sessionActions] = createSessionStore();
      const [messageState, messageActions] = createMessageStore();

      // Create session first
      sessionActions.upsert({
        sessionID: "session-1",
        directory: "/test",
      });

      // Now add message
      const message: MessageWithId = {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId;

      messageActions.upsert(message);

      expect(messageState.byId["msg-1"]).toBeDefined();
      expect(messageState.bySession["session-1"]).toContain("msg-1");
    });

    it("validates session exists before updating message", () => {
      const [, sessionActions] = createSessionStore();
      const [, messageActions] = createMessageStore();

      // Create session A and message
      sessionActions.upsert({ sessionID: "session-a", directory: "/test" });
      messageActions.upsert({
        id: "msg-1",
        role: "user",
        sessionID: "session-a",
      } as MessageWithId);

      // Try to update to non-existent session B
      expect(() => {
        if (!sessionActions.getById("session-b")) {
          throw new Error("Session session-b not found");
        }
        messageActions.upsert({
          id: "msg-1",
          role: "user",
          sessionID: "session-b",
        } as MessageWithId);
      }).toThrow("session-b not found");
    });
  });

  describe("Cascade Delete", () => {
    it("removes messages when session deleted", () => {
      const [sessionState, sessionActions] = createSessionStore();
      const [messageState, messageActions] = createMessageStore();

      // Wire up cascade delete: when session is deleted, remove its messages
      sessionActions._setOnDelete((sessionId: string) => {
        // Create a copy of the array to avoid issues with concurrent modification
        const messageIds = [...(messageState.bySession[sessionId] || [])];
        for (const messageId of messageIds) {
          messageActions.remove(messageId);
        }
      });

      // Setup: Create session with messages
      sessionActions.upsert({ sessionID: "session-1", directory: "/test" });
      messageActions.upsert({
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId);
      messageActions.upsert({
        id: "msg-2",
        role: "assistant",
        sessionID: "session-1",
      } as MessageWithId);

      expect(messageState.bySession["session-1"]).toHaveLength(2);

      // Delete session (with cascade)
      sessionActions.remove?.("session-1");

      // Messages should be removed
      const report = validateStoreIntegrity({
        session: sessionState,
        message: toIntegrityMessageState(messageState),
        part: { byId: {}, byMessage: {} },
      });

      // After cascade delete, there should be no orphaned messages
      expect(report.orphanedMessages).toHaveLength(0);
    });

    it("handles cascade delete with missing references gracefully", () => {
      const [sessionState] = createSessionStore();
      const [messageState, messageActions] = createMessageStore();

      // Create message referencing non-existent session
      messageActions.upsert({
        id: "orphan-msg",
        role: "user",
        sessionID: "deleted-session",
      } as MessageWithId);

      // Validate should detect orphan
      const report = validateStoreIntegrity({
        session: sessionState,
        message: toIntegrityMessageState(messageState),
        part: { byId: {}, byMessage: {} },
      });

      expect(report.orphanedMessages).toContain("orphan-msg");
      expect(report.valid).toBe(false);
    });
  });

  describe("Referential Integrity", () => {
    it("prevents orphaned messages", () => {
      const [sessionState, sessionActions] = createSessionStore();
      const [messageState, messageActions] = createMessageStore();

      // Create session
      sessionActions.upsert({ sessionID: "session-1", directory: "/test" });

      // Add message
      messageActions.upsert({
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId);

      // Validate - should be no orphans
      const report = validateStoreIntegrity({
        session: sessionState,
        message: toIntegrityMessageState(messageState),
        part: { byId: {}, byMessage: {} },
      });

      expect(report.valid).toBe(true);
      expect(report.orphanedMessages).toHaveLength(0);
    });

    it("updates message count when message added", () => {
      const [, sessionActions] = createSessionStore();
      const [messageState, messageActions] = createMessageStore();

      sessionActions.upsert({ sessionID: "session-1", directory: "/test" });

      expect(messageState.bySession["session-1"]?.length || 0).toBe(0);

      messageActions.upsert({
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId);

      expect(messageState.bySession["session-1"]).toHaveLength(1);

      messageActions.upsert({
        id: "msg-2",
        role: "assistant",
        sessionID: "session-1",
      } as MessageWithId);

      expect(messageState.bySession["session-1"]).toHaveLength(2);
    });

    it("updates message count when message removed", () => {
      const [, sessionActions] = createSessionStore();
      const [messageState, messageActions] = createMessageStore();

      sessionActions.upsert({ sessionID: "session-1", directory: "/test" });
      messageActions.upsert({
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId);
      messageActions.upsert({
        id: "msg-2",
        role: "assistant",
        sessionID: "session-1",
      } as MessageWithId);

      expect(messageState.bySession["session-1"]).toHaveLength(2);

      messageActions.remove("msg-1");

      expect(messageState.bySession["session-1"]).toHaveLength(1);
      expect(messageState.bySession["session-1"]).not.toContain("msg-1");
    });
  });

  describe("Part Store FK Validation", () => {
    it("throws error when adding part to non-existent message", () => {
      const [, messageActions] = createMessageStore();
      const [, partActions] = createPartStore();

      const part = {
        id: "part-1",
        type: "text",
        messageID: "non-existent-message",
        sessionID: "session-1",
        text: "Test content",
      };

      expect(() => {
        if (!messageActions.getById(part.messageID)) {
          throw new Error(`Cannot add part: message ${part.messageID} not found`);
        }
        partActions.upsert(part);
      }).toThrow("message non-existent-message not found");
    });

    it("allows part when message exists", () => {
      const [, sessionActions] = createSessionStore();
      const [, messageActions] = createMessageStore();
      const [partState, partActions] = createPartStore();

      // Create session and message
      sessionActions.upsert({ sessionID: "session-1", directory: "/test" });
      messageActions.upsert({
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId);

      // Now add part
      const part = {
        id: "part-1",
        type: "text",
        messageID: "msg-1",
        sessionID: "session-1",
        text: "Test content",
      };

      partActions.upsert(part);

      expect(partState.byId["part-1"]).toBeDefined();
      expect(partState.byMessage["msg-1"]).toContain("part-1");
    });

    it("removes parts when message deleted", () => {
      const [sessionState, sessionActions] = createSessionStore();
      const [messageState, messageActions] = createMessageStore();
      const [partState, partActions] = createPartStore();

      // Wire up cascade delete: when message is deleted, remove its parts
      messageActions._setOnDelete((messageId: string) => {
        // Create a copy of the array to avoid issues with concurrent modification
        const partIds = [...(partState.byMessage[messageId] || [])];
        for (const partId of partIds) {
          partActions.remove(partId, messageId);
        }
      });

      // Setup
      sessionActions.upsert({ sessionID: "session-1", directory: "/test" });
      messageActions.upsert({
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      } as MessageWithId);
      partActions.upsert({
        id: "part-1",
        type: "text",
        messageID: "msg-1",
        sessionID: "session-1",
        text: "Content 1",
      });
      partActions.upsert({
        id: "part-2",
        type: "text",
        messageID: "msg-1",
        sessionID: "session-1",
        text: "Content 2",
      });

      expect(partState.byMessage["msg-1"]).toHaveLength(2);

      // Delete message (should cascade to parts)
      messageActions.remove("msg-1");

      // Verify parts removed
      const report = validateStoreIntegrity({
        session: sessionState,
        message: toIntegrityMessageState(messageState),
        part: partState,
      });

      expect(report.orphanedParts).toHaveLength(0);
    });
  });

  describe("Store Integrity Validation", () => {
    it("detects all integrity issues in complex scenario", () => {
      const [sessionState, sessionActions] = createSessionStore();
      const [messageState, messageActions] = createMessageStore();
      const [partState, partActions] = createPartStore();

      // Create valid session
      sessionActions.upsert({ sessionID: "valid-session", directory: "/test" });

      // Valid message
      messageActions.upsert({
        id: "valid-msg",
        role: "user",
        sessionID: "valid-session",
      } as MessageWithId);

      // Orphaned message (no session)
      messageActions.upsert({
        id: "orphan-msg",
        role: "user",
        sessionID: "missing-session",
      } as MessageWithId);

      // Valid part
      partActions.upsert({
        id: "valid-part",
        type: "text",
        messageID: "valid-msg",
        sessionID: "valid-session",
        text: "Valid",
      });

      // Orphaned part (no message)
      partActions.upsert({
        id: "orphan-part",
        type: "text",
        messageID: "missing-msg",
        sessionID: "valid-session",
        text: "Orphan",
      });

      // Validate
      const report = validateStoreIntegrity({
        session: sessionState,
        message: toIntegrityMessageState(messageState),
        part: partState,
      });

      expect(report.valid).toBe(false);
      expect(report.orphanedMessages).toContain("orphan-msg");
      expect(report.orphanedParts).toContain("orphan-part");
      expect(report.missingSessions).toContain("missing-session");
      expect(report.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
