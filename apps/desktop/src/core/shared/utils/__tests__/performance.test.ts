/**
 * Tests for performance monitoring utilities
 *
 * Part of Phase 6: Cleanup & Optimization
 */

import { createPerformanceMonitor } from "@/core/shared/utils/performance";
import { beforeEach, describe, expect, it } from "vitest";

describe("createPerformanceMonitor", () => {
  let monitor: ReturnType<typeof createPerformanceMonitor>;

  beforeEach(() => {
    monitor = createPerformanceMonitor();
  });

  describe("startMeasure and endMeasure", () => {
    it("should track operation time", () => {
      monitor.startMeasure("test-operation");

      // Simulate some work
      const start = performance.now();
      while (performance.now() - start < 10) {
        // Busy wait for at least 10ms
      }

      const elapsed = monitor.endMeasure("test-operation");

      expect(elapsed).toBeGreaterThan(0);
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });

    it("should return 0 for unknown operation", () => {
      const elapsed = monitor.endMeasure("unknown-operation");
      expect(elapsed).toBe(0);
    });

    it("should handle multiple simultaneous operations", () => {
      monitor.startMeasure("operation-1");
      monitor.startMeasure("operation-2");

      const elapsed1 = monitor.endMeasure("operation-1");
      const elapsed2 = monitor.endMeasure("operation-2");

      expect(elapsed1).toBeGreaterThan(0);
      expect(elapsed2).toBeGreaterThan(0);
    });

    it("should support re-measuring same operation", () => {
      monitor.startMeasure("repeat-operation");
      monitor.endMeasure("repeat-operation");

      monitor.startMeasure("repeat-operation");
      const elapsed = monitor.endMeasure("repeat-operation");

      expect(elapsed).toBeGreaterThan(0);
    });
  });

  describe("getMetrics", () => {
    it("should return initial metrics", () => {
      const metrics = monitor.getMetrics();

      expect(metrics).toEqual({
        renderTime: 0,
        operationCount: 0,
        lastOperation: "",
        customMetrics: {},
      });
    });

    it("should track operation count", () => {
      monitor.startMeasure("op1");
      monitor.endMeasure("op1");

      monitor.startMeasure("op2");
      monitor.endMeasure("op2");

      const metrics = monitor.getMetrics();
      expect(metrics.operationCount).toBe(2);
    });

    it("should track last operation name", () => {
      monitor.startMeasure("first-op");
      monitor.endMeasure("first-op");

      monitor.startMeasure("last-op");
      monitor.endMeasure("last-op");

      const metrics = monitor.getMetrics();
      expect(metrics.lastOperation).toBe("last-op");
    });

    it("should track render time from operations", () => {
      monitor.startMeasure("render");
      const start = performance.now();
      while (performance.now() - start < 5) {
        // Busy wait
      }
      monitor.endMeasure("render");

      const metrics = monitor.getMetrics();
      expect(metrics.renderTime).toBeGreaterThan(0);
    });
  });

  describe("custom metrics", () => {
    it("should track custom metrics", () => {
      monitor.setCustomMetric("component-count", 42);
      monitor.setCustomMetric("memory-usage", 1024);

      const metrics = monitor.getMetrics();
      expect(metrics.customMetrics["component-count"]).toBe(42);
      expect(metrics.customMetrics["memory-usage"]).toBe(1024);
    });

    it("should overwrite existing custom metric", () => {
      monitor.setCustomMetric("value", 10);
      monitor.setCustomMetric("value", 20);

      const metrics = monitor.getMetrics();
      expect(metrics.customMetrics["value"]).toBe(20);
    });
  });

  describe("reset", () => {
    it("should clear all metrics", () => {
      monitor.startMeasure("op1");
      monitor.endMeasure("op1");
      monitor.setCustomMetric("test", 100);

      monitor.reset();

      const metrics = monitor.getMetrics();
      expect(metrics).toEqual({
        renderTime: 0,
        operationCount: 0,
        lastOperation: "",
        customMetrics: {},
      });
    });

    it("should allow new measurements after reset", () => {
      monitor.startMeasure("op1");
      monitor.endMeasure("op1");
      monitor.reset();

      monitor.startMeasure("op2");
      const elapsed = monitor.endMeasure("op2");

      expect(elapsed).toBeGreaterThan(0);
      expect(monitor.getMetrics().operationCount).toBe(1);
    });
  });
});
