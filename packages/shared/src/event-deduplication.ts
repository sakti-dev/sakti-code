/**
 * Event Deduplication
 *
 * Prevents duplicate event processing using an LRU cache of event IDs.
 * Part of Batch 2: Data Integrity
 *
 * @example
 * const deduplicator = new EventDeduplicator();
 * if (!deduplicator.isDuplicate(event.eventId)) {
 *   // Process the event
 * }
 */

export interface EventDeduplicatorOptions {
  /** Maximum number of event IDs to keep in cache */
  maxSize?: number;
}

/**
 * EventDeduplicator prevents duplicate event processing.
 *
 * Uses an LRU (Least Recently Used) cache to track processed event IDs.
 * When the cache reaches max size, oldest entries are evicted.
 *
 * Key features:
 * - O(1) duplicate detection
 * - Automatic eviction of old entries
 * - Memory-bounded operation
 */
export class EventDeduplicator {
  private cache: Map<string, number>;
  private maxSize: number;

  constructor(options: EventDeduplicatorOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.cache = new Map();
  }

  /**
   * Check if an event ID is a duplicate.
   * If not a duplicate, adds it to the cache.
   *
   * @param eventId - The event ID to check
   * @returns true if duplicate, false if new
   */
  isDuplicate(eventId: string): boolean {
    if (this.cache.has(eventId)) {
      // Update access time (move to end for LRU)
      this.cache.delete(eventId);
      this.cache.set(eventId, Date.now());
      return true;
    }

    // Add to cache
    this.cache.set(eventId, Date.now());

    // Evict oldest if over max size
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    return false;
  }

  /**
   * Check if an event ID has been seen without updating the cache.
   * Useful for checking without affecting LRU order.
   *
   * @param eventId - The event ID to check
   * @returns true if seen before, false if new
   */
  hasSeen(eventId: string): boolean {
    return this.cache.has(eventId);
  }

  /**
   * Get the current cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get the maximum cache size
   */
  getMaxSize(): number {
    return this.maxSize;
  }

  /**
   * Clear the cache (useful for testing)
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    utilization: number;
    oldestEntry?: number;
    newestEntry?: number;
  } {
    const timestamps = Array.from(this.cache.values());
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: this.cache.size / this.maxSize,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    };
  }

  /**
   * Manually add an event ID to the cache
   * Useful for pre-populating with known events
   */
  add(eventId: string): void {
    if (this.cache.has(eventId)) {
      this.cache.delete(eventId);
    }
    this.cache.set(eventId, Date.now());

    // Evict oldest if over max size
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Remove an event ID from the cache
   * Useful for allowing reprocessing of specific events
   */
  remove(eventId: string): boolean {
    return this.cache.delete(eventId);
  }
}

/**
 * Create a default event deduplicator
 */
export function createEventDeduplicator(options?: EventDeduplicatorOptions): EventDeduplicator {
  return new EventDeduplicator(options);
}

export default EventDeduplicator;
