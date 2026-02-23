/**
 * Event Contract Tests
 *
 * Validates that event payloads match their Zod schema definitions.
 * Tests both valid and invalid payloads for each event type.
 */

import { describe, expect, it } from "vitest";
import {
  MessagePartRemoved,
  MessagePartUpdated,
  MessageUpdated,
  PermissionAsked,
  PermissionReplied,
  QuestionAsked,
  QuestionRejected,
  QuestionReplied,
  ServerConnected,
  ServerHeartbeat,
  ServerInstanceDisposed,
  SessionCreated,
  SessionStatus,
  SessionUpdated,
} from "..";

describe("Event Contract Tests", () => {
  // Helper to get valid fixture for an event type
  function getValidFixture(eventType: string): unknown {
    const fixtures: Record<string, unknown> = {
      "server.connected": {},
      "server.heartbeat": {},
      "server.instance.disposed": { directory: "/test/path" },
      "message.updated": {
        info: {
          role: "assistant",
          id: "msg-123",
          sessionID: "session-123",
          time: { created: Date.now() },
          model: "test-model",
          provider: "test-provider",
        },
      },
      "message.part.updated": {
        messageID: "msg-123",
        part: {
          id: "part-123",
          type: "text",
          text: "Hello world",
          sessionID: "session-123",
          messageID: "msg-123",
        },
      },
      "message.part.updated:with delta": {
        messageID: "msg-123",
        part: {
          id: "part-123",
          type: "text",
          text: "Hello",
          sessionID: "session-123",
          messageID: "msg-123",
        },
        delta: " world",
      },
      "message.part.removed": {
        messageID: "msg-123",
        partID: "part-123",
        sessionID: "session-123",
      },
      "session.created": {
        sessionID: "session-123",
        directory: "/test/path",
      },
      "session.updated": {
        sessionID: "session-123",
        status: "idle",
        metadata: { key: "value" },
      },
      "session.status:idle": {
        sessionID: "session-123",
        status: { type: "idle" },
      },
      "session.status:busy": {
        sessionID: "session-123",
        status: { type: "busy" },
      },
      "session.status:retry": {
        sessionID: "session-123",
        status: { type: "retry", attempt: 1, message: "Retrying", next: Date.now() },
      },
      "permission.asked": {
        id: "perm-123",
        sessionID: "session-123",
        permission: "read",
        patterns: ["/test/*.txt"],
        always: [],
      },
      "permission.asked:with tool": {
        id: "perm-123",
        sessionID: "session-123",
        permission: "write",
        patterns: ["/test/file.txt"],
        always: [],
        tool: { messageID: "msg-123", callID: "call-123" },
      },
      "permission.replied": {
        sessionID: "session-123",
        requestID: "perm-123",
        reply: "once",
      },
      "question.asked": {
        id: "question-123",
        sessionID: "session-123",
        questions: [
          {
            header: "Scope",
            question: "Which scope should we target?",
            options: [{ label: "UI only" }, { label: "Core + UI" }],
          },
        ],
      },
      "question.replied": {
        sessionID: "session-123",
        requestID: "question-123",
        reply: "UI only",
      },
      "question.rejected": {
        sessionID: "session-123",
        requestID: "question-123",
        reason: "skip",
      },
    };
    return fixtures[eventType] ?? {};
  }

  // Helper to get invalid fixture for an event type
  function getInvalidFixture(eventType: string): unknown {
    const fixtures: Record<string, unknown> = {
      "server.connected": null, // should be object
      "server.heartbeat": "invalid", // should be object
      "server.instance.disposed": { directory: 123 }, // should be string
      "message.updated": {}, // missing required info field
      "message.part.updated": {
        part: {
          id: "part-123",
          type: "text",
          text: "Hello world",
          sessionID: "session-123",
          // missing messageID
        },
      },
      "message.part.removed": {
        messageID: null, // should be string
        partID: "part-123",
        sessionID: "session-123",
      },
      "session.created": {
        // missing required fields
      },
      "session.updated": {
        sessionID: "session-123",
        status: "invalid", // should be "idle" | "running" | "error"
      },
      "session.status": {
        sessionID: "session-123",
        status: { type: "invalid" }, // should be "idle" | "busy" | "retry"
      },
      "permission.asked": {
        id: 123, // should be string
        sessionID: "session-123",
        permission: "read",
        patterns: "not-array", // should be array
        always: [],
      },
      "permission.replied": {
        sessionID: "session-123",
        requestID: "perm-123",
        reply: "invalid", // should be "once" | "always" | "reject"
      },
      "question.asked": {
        id: 123, // should be string
        sessionID: "session-123",
        questions: "not-array", // should be array
      },
      "question.replied": {
        sessionID: "session-123",
        requestID: "question-123",
        // missing reply
      },
      "question.rejected": {
        sessionID: "session-123",
        // missing requestID
      },
    };
    return fixtures[eventType] ?? { invalid: true };
  }

  describe("Server Events", () => {
    it("ServerConnected validates correct payload", () => {
      const valid = getValidFixture("server.connected");
      expect(() => ServerConnected.properties.parse(valid)).not.toThrow();
    });

    it("ServerConnected rejects invalid payload", () => {
      // Schema is z.object({}) which accepts any object
      // Only non-objects should fail
      expect(() => ServerConnected.properties.parse(null)).toThrow();
      expect(() => ServerConnected.properties.parse(undefined)).toThrow();
      expect(() => ServerConnected.properties.parse("invalid")).toThrow();
    });

    it("ServerHeartbeat validates correct payload", () => {
      const valid = getValidFixture("server.heartbeat");
      expect(() => ServerHeartbeat.properties.parse(valid)).not.toThrow();
    });

    it("ServerHeartbeat rejects invalid payload", () => {
      const invalid = getInvalidFixture("server.heartbeat");
      expect(() => ServerHeartbeat.properties.parse(invalid)).toThrow();
    });

    it("ServerInstanceDisposed validates correct payload", () => {
      const valid = getValidFixture("server.instance.disposed");
      expect(() => ServerInstanceDisposed.properties.parse(valid)).not.toThrow();
    });

    it("ServerInstanceDisposed rejects invalid payload", () => {
      const invalid = getInvalidFixture("server.instance.disposed");
      expect(() => ServerInstanceDisposed.properties.parse(invalid)).toThrow();
    });
  });

  describe("Message Events", () => {
    it("MessageUpdated validates correct payload", () => {
      const valid = getValidFixture("message.updated");
      expect(() => MessageUpdated.properties.parse(valid)).not.toThrow();
    });

    it("MessageUpdated rejects invalid payload", () => {
      const invalid = getInvalidFixture("message.updated");
      expect(() => MessageUpdated.properties.parse(invalid)).toThrow();
      expect(() =>
        MessageUpdated.properties.parse({
          info: {
            role: "assistant",
          },
        })
      ).toThrow();
    });

    it("MessagePartUpdated validates correct payload", () => {
      const valid = getValidFixture("message.part.updated");
      expect(() => MessagePartUpdated.properties.parse(valid)).not.toThrow();
    });

    it("MessagePartUpdated validates payload with delta", () => {
      const valid = getValidFixture("message.part.updated:with delta");
      expect(() => MessagePartUpdated.properties.parse(valid)).not.toThrow();
    });

    it("MessagePartUpdated rejects invalid payload", () => {
      const invalid = getInvalidFixture("message.part.updated");
      expect(() => MessagePartUpdated.properties.parse(invalid)).toThrow();
      expect(() =>
        MessagePartUpdated.properties.parse({
          part: {
            id: "part-123",
            type: "text",
            text: "Hello",
            sessionID: "session-123",
            messageID: "msg-123",
            extra: { nested: true },
          },
        })
      ).not.toThrow();
    });

    it("MessagePartRemoved validates correct payload", () => {
      const valid = getValidFixture("message.part.removed");
      expect(() => MessagePartRemoved.properties.parse(valid)).not.toThrow();
    });

    it("MessagePartRemoved rejects invalid payload", () => {
      const invalid = getInvalidFixture("message.part.removed");
      expect(() => MessagePartRemoved.properties.parse(invalid)).toThrow();
    });
  });

  describe("Session Events", () => {
    it("SessionCreated validates correct payload", () => {
      const valid = getValidFixture("session.created");
      expect(() => SessionCreated.properties.parse(valid)).not.toThrow();
    });

    it("SessionCreated rejects invalid payload", () => {
      const invalid = getInvalidFixture("session.created");
      expect(() => SessionCreated.properties.parse(invalid)).toThrow();
    });

    it("SessionUpdated validates correct payload", () => {
      const valid = getValidFixture("session.updated");
      expect(() => SessionUpdated.properties.parse(valid)).not.toThrow();
    });

    it("SessionUpdated rejects invalid payload", () => {
      const invalid = getInvalidFixture("session.updated");
      expect(() => SessionUpdated.properties.parse(invalid)).toThrow();
    });

    it("SessionStatus validates idle status", () => {
      const valid = getValidFixture("session.status:idle");
      expect(() => SessionStatus.properties.parse(valid)).not.toThrow();
    });

    it("SessionStatus validates busy status", () => {
      const valid = getValidFixture("session.status:busy");
      expect(() => SessionStatus.properties.parse(valid)).not.toThrow();
    });

    it("SessionStatus validates retry status", () => {
      const valid = getValidFixture("session.status:retry");
      expect(() => SessionStatus.properties.parse(valid)).not.toThrow();
    });

    it("SessionStatus rejects invalid status", () => {
      const invalid = getInvalidFixture("session.status");
      expect(() => SessionStatus.properties.parse(invalid)).toThrow();
    });
  });

  describe("Permission Events", () => {
    it("PermissionAsked validates correct payload", () => {
      const valid = getValidFixture("permission.asked");
      expect(() => PermissionAsked.properties.parse(valid)).not.toThrow();
    });

    it("PermissionAsked validates payload with tool", () => {
      const valid = getValidFixture("permission.asked:with tool");
      expect(() => PermissionAsked.properties.parse(valid)).not.toThrow();
    });

    it("PermissionAsked rejects invalid payload", () => {
      const invalid = getInvalidFixture("permission.asked");
      expect(() => PermissionAsked.properties.parse(invalid)).toThrow();
    });

    it("PermissionReplied validates correct payload", () => {
      const valid = getValidFixture("permission.replied");
      expect(() => PermissionReplied.properties.parse(valid)).not.toThrow();
    });

    it("PermissionReplied rejects invalid payload", () => {
      const invalid = getInvalidFixture("permission.replied");
      expect(() => PermissionReplied.properties.parse(invalid)).toThrow();
    });
  });

  describe("Question Events", () => {
    it("QuestionAsked validates correct payload", () => {
      const valid = getValidFixture("question.asked");
      expect(() => QuestionAsked.properties.parse(valid)).not.toThrow();
    });

    it("QuestionAsked rejects invalid payload", () => {
      const invalid = getInvalidFixture("question.asked");
      expect(() => QuestionAsked.properties.parse(invalid)).toThrow();
    });

    it("QuestionReplied validates correct payload", () => {
      const valid = getValidFixture("question.replied");
      expect(() => QuestionReplied.properties.parse(valid)).not.toThrow();
    });

    it("QuestionReplied rejects invalid payload", () => {
      const invalid = getInvalidFixture("question.replied");
      expect(() => QuestionReplied.properties.parse(invalid)).toThrow();
    });

    it("QuestionRejected validates correct payload", () => {
      const valid = getValidFixture("question.rejected");
      expect(() => QuestionRejected.properties.parse(valid)).not.toThrow();
    });

    it("QuestionRejected rejects invalid payload", () => {
      const invalid = getInvalidFixture("question.rejected");
      expect(() => QuestionRejected.properties.parse(invalid)).toThrow();
    });
  });
});
