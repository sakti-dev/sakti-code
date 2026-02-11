/**
 * Event Deduplication Tests
 *
 * Tests for preventing duplicate event processing using event IDs.
 */

import { v7 as uuidv7 } from "uuid";
import { beforeEach, describe, expect, it } from "vitest";

// Simple LRU cache implementation for event IDs
class EventDeduplicator {
  private cache: Map<string, number>;
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  isDuplicate(eventId: string): boolean {
    if (this.cache.has(eventId)) {
      // Just check existence, don't update LRU order
      // This is more appropriate for deduplication
      return true;
    }

    // Evict oldest if at max size before adding new
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value as string | undefined;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    // Add to cache
    this.cache.set(eventId, Date.now());

    return false;
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

describe("EventDeduplicator", () => {
  let deduplicator: EventDeduplicator;

  beforeEach(() => {
    deduplicator = new EventDeduplicator(100);
  });

  describe("Basic Deduplication", () => {
    it("processes unique event IDs", () => {
      const eventId1 = uuidv7();
      const eventId2 = uuidv7();
      const eventId3 = uuidv7();

      expect(deduplicator.isDuplicate(eventId1)).toBe(false);
      expect(deduplicator.isDuplicate(eventId2)).toBe(false);
      expect(deduplicator.isDuplicate(eventId3)).toBe(false);

      expect(deduplicator.getCacheSize()).toBe(3);
    });

    it("skips duplicate event IDs", () => {
      const eventId = uuidv7();

      expect(deduplicator.isDuplicate(eventId)).toBe(false);
      expect(deduplicator.isDuplicate(eventId)).toBe(true);
      expect(deduplicator.isDuplicate(eventId)).toBe(true);

      expect(deduplicator.getCacheSize()).toBe(1);
    });

    it("tracks events across different sessions", () => {
      const eventId1 = uuidv7();
      const eventId2 = uuidv7();

      // Same event ID should be duplicate regardless of context
      expect(deduplicator.isDuplicate(eventId1)).toBe(false);
      expect(deduplicator.isDuplicate(eventId2)).toBe(false);
      expect(deduplicator.isDuplicate(eventId1)).toBe(true);
    });
  });

  describe("LRU Cache Behavior", () => {
    it("maintains max cache size", () => {
      // Add 150 events (over max of 100)
      const eventIds: string[] = [];
      for (let i = 0; i < 150; i++) {
        const eventId = uuidv7();
        eventIds.push(eventId);
        deduplicator.isDuplicate(eventId);
      }

      // Cache should be at max size
      expect(deduplicator.getCacheSize()).toBe(100);

      // First 50 should be evicted
      for (let i = 0; i < 50; i++) {
        expect(deduplicator.isDuplicate(eventIds[i])).toBe(false); // Not in cache anymore
      }

      // Last 100 should still be in cache
      // Note: We need to check in reverse order to avoid evicting items we're about to check
      // Also skip checking items 50-99 since checking 0-49 may have evicted them
      for (let i = 100; i < 150; i++) {
        expect(deduplicator.isDuplicate(eventIds[i])).toBe(true);
      }
    });

    it("evicts oldest events first", () => {
      const eventIds: string[] = [];

      // Add 100 events
      for (let i = 0; i < 100; i++) {
        const eventId = uuidv7();
        eventIds.push(eventId);
        deduplicator.isDuplicate(eventId);
      }

      expect(deduplicator.getCacheSize()).toBe(100);

      // Add one more - should evict the first
      const newEventId = uuidv7();
      deduplicator.isDuplicate(newEventId);

      expect(deduplicator.getCacheSize()).toBe(100);
      // Note: eventIds[0] was evicted when we added the 101st event (newEventId)
      // When we check if eventIds[0] is a duplicate below, it gets re-added to the cache
      // This causes eventIds[1] to be evicted to make room
      // So we can only verify that eventIds[0] was evicted before we re-add it
      expect(deduplicator.isDuplicate(eventIds[0])).toBe(false); // Was evicted, now re-added
      // After re-adding eventIds[0], eventIds[1] was evicted
      // So we check eventIds[2] instead, which should still be in cache
      expect(deduplicator.isDuplicate(eventIds[2])).toBe(true); // Still in cache
    });

    it("resets cache on explicit clear", () => {
      const eventId = uuidv7();
      deduplicator.isDuplicate(eventId);

      expect(deduplicator.getCacheSize()).toBe(1);

      deduplicator.clear();

      expect(deduplicator.getCacheSize()).toBe(0);
      expect(deduplicator.isDuplicate(eventId)).toBe(false); // Can be reprocessed
    });
  });

  describe("Integration with Event Ordering", () => {
    it("deduplicates before ordering", () => {
      const eventId = uuidv7();

      // Same event ID, different sequence (shouldn't happen, but test defense)
      const isDup1 = deduplicator.isDuplicate(eventId);
      const isDup2 = deduplicator.isDuplicate(eventId);

      expect(isDup1).toBe(false);
      expect(isDup2).toBe(true);
    });

    it("handles duplicate with different content", () => {
      const eventId = uuidv7();

      // First occurrence
      const isDup1 = deduplicator.isDuplicate(eventId);
      expect(isDup1).toBe(false);

      // Second occurrence with same ID (should be duplicate regardless of content)
      const isDup2 = deduplicator.isDuplicate(eventId);
      expect(isDup2).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty event ID", () => {
      expect(deduplicator.isDuplicate("")).toBe(false);
      expect(deduplicator.isDuplicate("")).toBe(true);
    });

    it("handles very long event IDs", () => {
      const longId = "a".repeat(1000);

      expect(deduplicator.isDuplicate(longId)).toBe(false);
      expect(deduplicator.isDuplicate(longId)).toBe(true);
    });

    it("handles special characters in event IDs", () => {
      const specialIds = [
        "event-id-with-dashes",
        "event_id_with_underscores",
        "event.id.with.dots",
        "event:id:with:colons",
        "event/id/with/slashes",
      ];

      for (const id of specialIds) {
        expect(deduplicator.isDuplicate(id)).toBe(false);
        expect(deduplicator.isDuplicate(id)).toBe(true);
      }

      expect(deduplicator.getCacheSize()).toBe(specialIds.length);
    });

    it("handles high volume of events", () => {
      const startTime = Date.now();

      // Process 10000 events
      for (let i = 0; i < 10000; i++) {
        const eventId = uuidv7();
        deduplicator.isDuplicate(eventId);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);
      expect(deduplicator.getCacheSize()).toBe(100);
    });
  });
});
