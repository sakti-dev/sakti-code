/**
 * Event Guards Tests
 *
 * Tests for SSE event type guards and validation
 */

// @vitest-environment jsdom
import {
  getKnownEventTypes,
  getPayload,
  isEventType,
  isKnownEventType,
  isRecord,
  isServerEvent,
  isString,
  parseServerEvent,
} from "@sakti-code/shared/event-guards";
import { describe, expect, it } from "vitest";

describe("event-guards", () => {
  describe("isRecord", () => {
    it("returns true for plain objects", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord({ foo: "bar" })).toBe(true);
    });

    it("returns false for primitives", () => {
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord("string")).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord(true)).toBe(false);
    });

    it("returns false for arrays", () => {
      expect(isRecord([])).toBe(false);
      expect(isRecord([1, 2, 3])).toBe(false);
    });

    it("returns true for class instances", () => {
      class TestClass {}
      expect(isRecord(new TestClass())).toBe(true);
    });
  });

  describe("isString", () => {
    it("returns true for strings", () => {
      expect(isString("")).toBe(true);
      expect(isString("hello")).toBe(true);
      expect(isString("123")).toBe(true);
    });

    it("returns false for non-strings", () => {
      expect(isString(null)).toBe(false);
      expect(isString(undefined)).toBe(false);
      expect(isString(123)).toBe(false);
      expect(isString({})).toBe(false);
    });
  });

  describe("isServerEvent", () => {
    it("returns true for valid server events", () => {
      expect(isServerEvent({ type: "test", properties: {} })).toBe(true);
      expect(isServerEvent({ type: "message.updated", properties: { info: {} } })).toBe(true);
      expect(isServerEvent({ type: "session.created", properties: { sessionID: "abc" } })).toBe(
        true
      );
    });

    it("returns true for events with directory", () => {
      expect(isServerEvent({ type: "test", properties: {}, directory: "/path" })).toBe(true);
    });

    it("returns false for invalid structures", () => {
      expect(isServerEvent({})).toBe(false);
      expect(isServerEvent({ type: 123, properties: {} })).toBe(false);
      expect(isServerEvent({ type: "test" })).toBe(false);
      expect(isServerEvent({ properties: {} })).toBe(false);
      expect(isServerEvent(null)).toBe(false);
    });

    it("returns false when type is not string", () => {
      expect(isServerEvent({ type: null, properties: {} })).toBe(false);
      expect(isServerEvent({ type: undefined, properties: {} })).toBe(false);
    });
  });

  describe("isKnownEventType", () => {
    it("returns true for known event types", () => {
      expect(isKnownEventType("server.connected")).toBe(true);
      expect(isKnownEventType("message.updated")).toBe(true);
      expect(isKnownEventType("permission.asked")).toBe(true);
      expect(isKnownEventType("session.status")).toBe(true);
      expect(isKnownEventType("task.updated")).toBe(true);
      expect(isKnownEventType("task-session.updated")).toBe(true);
    });

    it("returns false for unknown event types", () => {
      expect(isKnownEventType("unknown.event")).toBe(false);
      expect(isKnownEventType("")).toBe(false);
      expect(isKnownEventType("fake.event")).toBe(false);
    });

    it("returns false for non-string input", () => {
      expect(isKnownEventType(null as unknown as string)).toBe(false);
      expect(isKnownEventType(undefined as unknown as string)).toBe(false);
    });
  });

  describe("getKnownEventTypes", () => {
    it("returns all known event types", () => {
      const types = getKnownEventTypes();
      expect(types).toContain("server.connected");
      expect(types).toContain("message.updated");
      expect(types).toContain("permission.asked");
      expect(types).toContain("task.updated");
      expect(types).toContain("task-session.updated");
      expect(types.length).toBeGreaterThan(0);
    });

    it("returns a readonly array", () => {
      const types = getKnownEventTypes();
      // TypeScript should prevent mutation
      expect(Array.isArray(types)).toBe(true);
    });
  });

  describe("isEventType", () => {
    it("narrows type when match", () => {
      const event = { type: "message.updated" };
      if (isEventType(event, "message.updated")) {
        // TypeScript knows event.type is exactly "message.updated"
        expect(event.type).toBe("message.updated");
      }
    });

    it("returns false for non-matching types", () => {
      expect(isEventType({ type: "message.updated" }, "session.created")).toBe(false);
    });

    it("works with all event types", () => {
      expect(isEventType({ type: "server.connected" }, "server.connected")).toBe(true);
      expect(isEventType({ type: "permission.asked" }, "permission.asked")).toBe(true);
    });
  });

  describe("getPayload", () => {
    it("returns undefined when type doesn't match", () => {
      const event = {
        type: "message.updated",
        properties: { info: { id: "123" } },
      };
      expect(getPayload(event, "session.created")).toBeUndefined();
    });

    it("returns properties when type matches", () => {
      const payload = { info: { id: "123" } };
      const event = { type: "message.updated", properties: payload };
      expect(getPayload(event, "message.updated")).toEqual(payload);
    });

    it("preserves payload structure", () => {
      const payload = {
        sessionID: "abc",
        status: { type: "idle" as const },
      };
      const event = { type: "session.status", properties: payload };
      const result = getPayload(event, "session.status");
      expect(result).toEqual(payload);
      expect(result?.sessionID).toBe("abc");
    });
  });

  describe("parseServerEvent", () => {
    const validEventId = "019c4da0-fc0b-713c-984e-b2aca339c97b";

    it("parses valid JSON string events", () => {
      const result = parseServerEvent(
        `{"type":"test","properties":{},"eventId":"${validEventId}","sequence":1,"timestamp":${Date.now()}}`
      );
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("parses valid object events", () => {
      const result = parseServerEvent({
        type: "test",
        properties: {},
        eventId: validEventId,
        sequence: 1,
        timestamp: Date.now(),
      });
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("parses events with directory", () => {
      const result = parseServerEvent({
        type: "test",
        properties: {},
        directory: "/home/user/project",
        eventId: validEventId,
        sequence: 1,
        timestamp: Date.now(),
      });
      expect(result.success).toBe(true);
      expect(result.event?.directory).toBe("/home/user/project");
    });

    it("parses events with nested properties", () => {
      const result = parseServerEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-123",
            role: "assistant",
          },
        },
        eventId: validEventId,
        sequence: 1,
        timestamp: Date.now(),
      });
      expect(result.success).toBe(true);
      expect(result.event?.properties).toEqual({
        info: {
          id: "msg-123",
          role: "assistant",
        },
      });
    });

    it("returns error for invalid JSON", () => {
      const result = parseServerEvent("invalid json");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.event).toBeUndefined();
    });

    it("returns error for invalid structure", () => {
      const result = parseServerEvent({ type: 123, properties: "invalid" });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error for missing type", () => {
      const result = parseServerEvent({ properties: {} });
      expect(result.success).toBe(false);
    });

    it("returns error for missing properties", () => {
      const result = parseServerEvent({ type: "test" });
      expect(result.success).toBe(false);
    });

    it("handles null input", () => {
      const result = parseServerEvent(null);
      expect(result.success).toBe(false);
    });

    it("handles arrays as input", () => {
      const result = parseServerEvent([]);
      expect(result.success).toBe(false);
    });

    it("parses real server event types", () => {
      const result = parseServerEvent({
        type: "session.status",
        properties: {
          sessionID: "019c4da0-fc0b-713c-984e-b2aca339c97c",
          status: { type: "idle" },
        },
        eventId: validEventId,
        sequence: 1,
        timestamp: Date.now(),
      });
      expect(result.success).toBe(true);
      expect(result.event?.type).toBe("session.status");
    });

    it("handles empty properties", () => {
      const result = parseServerEvent(
        `{"type":"server.heartbeat","properties":{},"eventId":"${validEventId}","sequence":1,"timestamp":${Date.now()}}`
      );
      expect(result.success).toBe(true);
      expect(result.event?.properties).toEqual({});
    });
  });
});
