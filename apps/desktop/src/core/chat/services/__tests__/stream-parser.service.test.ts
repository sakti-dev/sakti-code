/**
 * Stream Parser Tests
 */

import { createStreamParser } from "@/core/chat/services/stream-parser.service";
import { describe, expect, it } from "vitest";

describe("StreamParser", () => {
  describe("parse", () => {
    it("parses server.connected events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "server.connected",
        properties: {},
        directory: "/path",
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event).toEqual({
        type: "server.connected",
        properties: {},
        directory: "/path",
      });
    });

    it("parses session.created events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "session.created",
        properties: { sessionID: "s1", directory: "/path" },
        directory: "/path",
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event).toEqual({
        type: "session.created",
        properties: { sessionID: "s1", directory: "/path" },
        directory: "/path",
      });
    });

    it("parses session.updated events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "session.updated",
        properties: { sessionID: "s1", status: "running" },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("session.updated");
    });

    it("parses message.updated events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "message.updated",
        properties: {
          info: { role: "user" },
        },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("message.updated");
    });

    it("parses message.part.updated events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "message.part.updated",
        properties: {
          part: { type: "text", id: "p1" },
        },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("message.part.updated");
    });

    it("parses session.status events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "session.status",
        properties: {
          sessionID: "s1",
          status: { type: "idle" },
        },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("session.status");
    });

    it("parses permission.asked events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "permission.asked",
        properties: {
          id: "req1",
          sessionID: "s1",
          permission: "fs:write",
          patterns: ["*.txt"],
          always: [],
        },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("permission.asked");
    });

    it("parses permission.replied events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "permission.replied",
        properties: {
          sessionID: "s1",
          requestID: "req1",
          reply: "once",
        },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("permission.replied");
    });

    it("parses question.asked events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "question.asked",
        properties: {
          id: "q1",
          sessionID: "s1",
          questions: [{ id: "x", label: "Name?" }],
        },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("question.asked");
    });

    it("parses server.instance.disposed events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "server.instance.disposed",
        properties: {
          directory: "/path",
        },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("server.instance.disposed");
    });

    it("parses message.part.removed events", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "message.part.removed",
        properties: {
          partID: "p1",
          messageID: "m1",
          sessionID: "s1",
        },
      });

      const result = parser.parse(data);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("message.part.removed");
    });

    it("returns error for malformed JSON", () => {
      const parser = createStreamParser();
      const result = parser.parse("invalid json");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Parse error");
    });

    it("returns error for unknown event type", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "unknown.event",
        properties: {},
      });

      const result = parser.parse(data);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown event type");
    });

    it("returns error for missing type field", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        properties: {},
      });

      const result = parser.parse(data);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid event structure");
    });
  });

  describe("parseMessageEvent", () => {
    it("parses MessageEvent data", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "session.created",
        properties: { sessionID: "s1", directory: "/path" },
        directory: "/path",
      });

      const msgEvent = new MessageEvent("message", { data });
      const result = parser.parseMessageEvent(msgEvent);

      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("session.created");
    });

    it("handles MessageEvent with lastEventId", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "session.created",
        properties: { sessionID: "s1", directory: "/path" },
        directory: "/path",
      });

      const msgEvent = new MessageEvent("message", {
        data,
        lastEventId: "evt-123",
      });
      const result = parser.parseMessageEvent(msgEvent);

      expect(result.success).toBe(true);
    });
  });

  describe("metrics", () => {
    it("tracks successful parses", () => {
      const parser = createStreamParser();
      const data = JSON.stringify({
        type: "session.created",
        properties: { sessionID: "s1", directory: "/path" },
        directory: "/path",
      });

      parser.parse(data);

      const metrics = parser.getMetrics();
      expect(metrics.totalParsed).toBe(1);
      expect(metrics.totalErrors).toBe(0);
    });

    it("tracks errors", () => {
      const parser = createStreamParser();
      parser.parse("invalid");

      const metrics = parser.getMetrics();
      expect(metrics.totalParsed).toBe(0);
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.lastError).toBeDefined();
    });

    it("tracks last error message", () => {
      const parser = createStreamParser();
      parser.parse("bad data");

      const metrics = parser.getMetrics();
      // The error message contains the JSON parse error
      expect(metrics.lastError).toBeDefined();
      expect(metrics.lastError).toBeTruthy();
    });
  });
});
