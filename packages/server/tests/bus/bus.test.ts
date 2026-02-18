/**
 * Tests for Bus Event System
 *
 * TDD: Write failing tests to find integration issues
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  clearAll,
  getSessionSequence,
  getSubscriptionCount,
  MessageUpdated,
  once,
  publish,
  resetSessionSequence,
  ServerConnected,
  SessionCreated,
  subscribe,
  subscribeAll,
} from "../../src/bus";
import { defineBusEvent, getRegisteredTypes, isRegistered } from "../../src/bus/bus-event";

describe("Bus Event System", () => {
  beforeEach(() => {
    clearAll();
  });

  describe("event definitions", () => {
    it("should register custom event types", () => {
      defineBusEvent("custom.event", z.object({ data: z.string() }));
      expect(isRegistered("custom.event")).toBe(true);
    });

    it("should return registered types", () => {
      const types = getRegisteredTypes();
      expect(types.length).toBeGreaterThan(0);
      expect(types).toContain("server.connected");
    });
  });

  describe("publish-subscribe", () => {
    it("should publish event and trigger subscriber", async () => {
      const callback = vi.fn();
      subscribe(ServerConnected, callback);

      await publish(ServerConnected, {});

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].type).toBe("server.connected");
    });

    it("should pass properties to subscriber", async () => {
      const callback = vi.fn();
      subscribe(SessionCreated, callback);

      await publish(SessionCreated, {
        sessionID: "test-session",
        directory: "/test/dir",
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].properties.sessionID).toBe("test-session");
    });

    it("should trigger multiple subscribers for same event", async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      subscribe(ServerConnected, callback1);
      subscribe(ServerConnected, callback2);

      await publish(ServerConnected, {});

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it("should return unsubscribe function", async () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(ServerConnected, callback);

      await publish(ServerConnected, {});
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      await publish(ServerConnected, {});

      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it("should support wildcard subscriptions", async () => {
      const callback = vi.fn();
      subscribeAll(callback);

      await publish(ServerConnected, {});
      await publish(SessionCreated, { sessionID: "s1", directory: "/d1" });

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it("should support once subscriptions", async () => {
      const callback = vi.fn(() => "done" as const);
      once(ServerConnected, callback);

      await publish(ServerConnected, {});
      await publish(ServerConnected, {});

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("event integrity (Batch 2)", () => {
    it("should include eventId in payload", async () => {
      const callback = vi.fn();
      subscribe(ServerConnected, callback);

      await publish(ServerConnected, {});

      const payload = callback.mock.calls[0][0];
      expect(payload.eventId).toBeDefined();
      expect(typeof payload.eventId).toBe("string");
    });

    it("should include timestamp in payload", async () => {
      const callback = vi.fn();
      subscribe(ServerConnected, callback);

      await publish(ServerConnected, {});

      const payload = callback.mock.calls[0][0];
      expect(payload.timestamp).toBeDefined();
      expect(typeof payload.timestamp).toBe("number");
    });

    it("should include sequence number in payload", async () => {
      const callback = vi.fn();
      subscribe(ServerConnected, callback);

      await publish(ServerConnected, {});

      const payload = callback.mock.calls[0][0];
      expect(payload.sequence).toBeDefined();
      expect(typeof payload.sequence).toBe("number");
    });

    it("should track per-session sequence numbers", async () => {
      const callback = vi.fn();
      subscribe(MessageUpdated, callback);

      await publish(MessageUpdated, {
        info: { id: "m1", sessionID: "session-1", role: "user", time: { created: 123 } },
      });
      await publish(MessageUpdated, {
        info: { id: "m2", sessionID: "session-1", role: "user", time: { created: 124 } },
      });

      // Should have 2 events with different sequences
      const seq1 = callback.mock.calls[0][0].sequence;
      const seq2 = callback.mock.calls[1][0].sequence;
      expect(seq2).toBe(seq1 + 1);
    });

    it("should reset session sequence", async () => {
      resetSessionSequence("session-1");
      expect(getSessionSequence("session-1")).toBe(0);
    });
  });

  describe("subscription management", () => {
    it("should count subscriptions", () => {
      subscribe(ServerConnected, vi.fn());
      subscribe(ServerConnected, vi.fn());
      subscribe(SessionCreated, vi.fn());

      expect(getSubscriptionCount()).toBe(3);
    });

    it("should clear all subscriptions", () => {
      subscribe(ServerConnected, vi.fn());
      subscribe(SessionCreated, vi.fn());

      clearAll();

      expect(getSubscriptionCount()).toBe(0);
    });
  });
});
