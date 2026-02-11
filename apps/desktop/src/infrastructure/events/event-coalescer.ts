/**
 * Event Coalescer
 *
 * Batches events within a time window to reduce reactive updates.
 * Uses SolidJS batch() for efficient reactive triggering.
 */

import { batch } from "solid-js";
import type { TypedSSEEvent } from "./event-source";

export interface CoalescerConfig {
  batchWindowMs?: number; // Default: 50ms
  maxQueueSize?: number; // Default: 200 events
  onQueueFull?: (droppedCount: number) => void;
}

export interface EventCoalescer {
  add: (event: TypedSSEEvent) => void;
  drain: () => void;
  flush: () => TypedSSEEvent[];
  getQueueSize: () => number;
  getMetrics: () => CoalescerMetrics;
}

export interface CoalescerMetrics {
  totalEventsProcessed: number;
  totalBatches: number;
  totalDropped: number;
  currentQueueSize: number;
}

export function createEventCoalescer(
  onEvents: (events: TypedSSEEvent[]) => void,
  config: CoalescerConfig = {}
): EventCoalescer {
  const { batchWindowMs = 50, maxQueueSize = 200, onQueueFull } = config;

  let queue: TypedSSEEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let metrics: CoalescerMetrics = {
    totalEventsProcessed: 0,
    totalBatches: 0,
    totalDropped: 0,
    currentQueueSize: 0,
  };

  const scheduleFlush = () => {
    if (flushTimer) return;

    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      drain();
    }, batchWindowMs);
  };

  const drain = () => {
    if (queue.length === 0) return;

    const eventsToProcess = queue.splice(0);
    metrics.currentQueueSize = 0;
    metrics.totalBatches += 1;

    batch(() => {
      onEvents(eventsToProcess);
    });
  };

  const add = (event: TypedSSEEvent) => {
    metrics.totalEventsProcessed += 1;

    // Check queue limit
    if (queue.length >= maxQueueSize) {
      const droppedCount = queue.length - maxQueueSize + 1;
      metrics.totalDropped += droppedCount;
      queue.splice(0, droppedCount);
      onQueueFull?.(droppedCount);
    }

    queue.push(event);
    metrics.currentQueueSize = queue.length;

    scheduleFlush();
  };

  const flush = () => {
    const events = [...queue];
    queue = [];
    metrics.currentQueueSize = 0;
    return events;
  };

  const getQueueSize = () => queue.length;

  const getMetrics = () => ({ ...metrics });

  return {
    add,
    drain,
    flush,
    getQueueSize,
    getMetrics,
  };
}
