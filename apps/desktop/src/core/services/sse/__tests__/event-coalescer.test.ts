/**
 * Event Coalescer Tests
 */

import { createEventCoalescer } from "@/core/services/sse/event-coalescer";
import type { AllServerEvents, EventType } from "@sakti-code/shared/event-types";
import { describe, expect, it, vi } from "vitest";

let nextSequence = 1;
function mkEvent<T extends EventType>(
  type: T,
  properties: Extract<AllServerEvents, { type: T }>["properties"],
  directory?: string
): Extract<AllServerEvents, { type: T }> {
  return {
    type,
    properties,
    directory,
    eventId: `evt-${nextSequence}`,
    sequence: nextSequence++,
    timestamp: Date.now(),
  } as Extract<AllServerEvents, { type: T }>;
}

describe("EventCoalescer", () => {
  describe("batching", () => {
    it("batches events within window", async () => {
      const onEvents = vi.fn();
      const coalescer = createEventCoalescer(onEvents, { batchWindowMs: 50 });

      coalescer.add(mkEvent("session.created", { sessionID: "s1", directory: "/path" }, "/path"));
      coalescer.add(mkEvent("message.updated", { info: { role: "user" } }));

      // Wait for batch window
      await new Promise(resolve => setTimeout(resolve, 60));

      expect(onEvents).toHaveBeenCalledTimes(1);
      expect(onEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: "session.created" }),
          expect.objectContaining({ type: "message.updated" }),
        ])
      );
    });

    it("drains events on demand", () => {
      const onEvents = vi.fn();
      const coalescer = createEventCoalescer(onEvents, { batchWindowMs: 1000 });

      coalescer.add(mkEvent("session.created", { sessionID: "s1", directory: "/path" }, "/path"));
      coalescer.add(mkEvent("message.updated", { info: { role: "user" } }));

      coalescer.drain();

      expect(onEvents).toHaveBeenCalledTimes(1);
      expect(onEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: "session.created" }),
          expect.objectContaining({ type: "message.updated" }),
        ])
      );
    });

    it("flushes events without calling callback", () => {
      const onEvents = vi.fn();
      const coalescer = createEventCoalescer(onEvents, { batchWindowMs: 1000 });

      coalescer.add(mkEvent("session.created", { sessionID: "s1", directory: "/path" }, "/path"));
      coalescer.add(mkEvent("message.updated", { info: { role: "user" } }));

      const flushed = coalescer.flush();

      expect(onEvents).not.toHaveBeenCalled();
      expect(flushed).toHaveLength(2);
      expect(flushed[0].type).toBe("session.created");
      expect(flushed[1].type).toBe("message.updated");
      expect(coalescer.getQueueSize()).toBe(0);
    });
  });

  describe("queue limits", () => {
    it("enforces max queue size", () => {
      const onEvents = vi.fn();
      const onQueueFull = vi.fn();
      const coalescer = createEventCoalescer(onEvents, {
        maxQueueSize: 5,
        onQueueFull,
      });

      // Add 10 events to a queue of max 5
      for (let i = 0; i < 10; i++) {
        coalescer.add(
          mkEvent("session.created", { sessionID: `s${i}`, directory: "/path" }, "/path")
        );
      }

      expect(coalescer.getQueueSize()).toBeLessThanOrEqual(5);
      expect(onQueueFull).toHaveBeenCalled();
    });

    it("tracks dropped events in metrics", () => {
      const onEvents = vi.fn();
      const coalescer = createEventCoalescer(onEvents, { maxQueueSize: 3 });

      for (let i = 0; i < 10; i++) {
        coalescer.add(
          mkEvent("session.created", { sessionID: `s${i}`, directory: "/path" }, "/path")
        );
      }

      const metrics = coalescer.getMetrics();
      expect(metrics.totalDropped).toBeGreaterThan(0);
      expect(metrics.totalEventsProcessed).toBe(10);
    });
  });

  describe("metrics", () => {
    it("tracks processed events", () => {
      const onEvents = vi.fn();
      const coalescer = createEventCoalescer(onEvents);

      coalescer.add(mkEvent("session.created", { sessionID: "s1", directory: "/path" }, "/path"));
      coalescer.add(mkEvent("message.updated", { info: { role: "user" } }));

      const metrics = coalescer.getMetrics();
      expect(metrics.totalEventsProcessed).toBe(2);
    });

    it("tracks batch count", async () => {
      const onEvents = vi.fn();
      const coalescer = createEventCoalescer(onEvents, { batchWindowMs: 50 });

      coalescer.add(mkEvent("session.created", { sessionID: "s1", directory: "/path" }, "/path"));
      await new Promise(resolve => setTimeout(resolve, 60));

      coalescer.add(mkEvent("message.updated", { info: { role: "user" } }));
      await new Promise(resolve => setTimeout(resolve, 60));

      const metrics = coalescer.getMetrics();
      expect(metrics.totalBatches).toBe(2);
    });

    it("tracks current queue size", () => {
      const onEvents = vi.fn();
      const coalescer = createEventCoalescer(onEvents, { batchWindowMs: 1000 });

      expect(coalescer.getMetrics().currentQueueSize).toBe(0);

      coalescer.add(mkEvent("session.created", { sessionID: "s1", directory: "/path" }, "/path"));
      expect(coalescer.getMetrics().currentQueueSize).toBe(1);

      coalescer.add(mkEvent("message.updated", { info: { role: "user" } }));
      expect(coalescer.getMetrics().currentQueueSize).toBe(2);

      coalescer.drain();
      expect(coalescer.getMetrics().currentQueueSize).toBe(0);
    });
  });

  describe("reactive updates", () => {
    it("uses SolidJS batch for reactive updates", async () => {
      const onEvents = vi.fn();
      const coalescer = createEventCoalescer(onEvents, { batchWindowMs: 50 });

      coalescer.add(mkEvent("session.created", { sessionID: "s1", directory: "/path" }, "/path"));
      coalescer.add(mkEvent("message.updated", { info: { role: "user" } }));

      await new Promise(resolve => setTimeout(resolve, 60));

      // Verify callback was called once (batched)
      expect(onEvents).toHaveBeenCalledTimes(1);
    });
  });
});
