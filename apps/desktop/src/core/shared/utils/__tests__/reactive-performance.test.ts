/**
 * Tests for SolidJS reactive performance monitoring utilities
 *
 * Part of Phase 6: Cleanup & Optimization
 */

import {
  useOperationMonitor,
  useReactivePerformanceMonitor,
  useRenderMonitor,
} from "@/core/shared/utils/reactive-performance";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock SolidJS hooks for testing
const mockOnCleanup = vi.fn();
const mockOnMount = vi.fn();

vi.mock("solid-js", () => ({
  onCleanup: (fn: () => void) => mockOnCleanup(fn),
  onMount: (fn: () => void) => mockOnMount(fn),
}));

describe("useRenderMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return render monitor functions", () => {
    const monitor = useRenderMonitor("TestComponent");

    expect(monitor.renderCount).toBeInstanceOf(Function);
    expect(monitor.lastRenderTime).toBeInstanceOf(Function);
  });

  it("should call onMount with callback", () => {
    useRenderMonitor("TestComponent");

    expect(mockOnMount).toHaveBeenCalled();
    const mountCallback = mockOnMount.mock.calls[0][0];
    expect(mountCallback).toBeInstanceOf(Function);
  });

  it("should call onCleanup with callback", () => {
    useRenderMonitor("TestComponent");

    expect(mockOnCleanup).toHaveBeenCalled();
    const cleanupCallback = mockOnCleanup.mock.calls[0][0];
    expect(cleanupCallback).toBeInstanceOf(Function);
  });

  it("should log render stats on cleanup", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    useRenderMonitor("TestComponent");

    // Trigger cleanup callback
    const cleanupCallback = mockOnCleanup.mock.calls[0][0];
    cleanupCallback();

    expect(consoleSpy).toHaveBeenCalledWith(
      "[RenderMonitor] TestComponent:",
      expect.objectContaining({
        renderCount: expect.any(Number),
        totalTime: expect.any(String),
        avgRenderTime: expect.any(String),
      })
    );

    consoleSpy.mockRestore();
  });
});

describe("useOperationMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return operation monitor functions", () => {
    const monitor = useOperationMonitor();

    expect(monitor.startOperation).toBeInstanceOf(Function);
    expect(monitor.endOperation).toBeInstanceOf(Function);
    expect(monitor.getMetrics).toBeInstanceOf(Function);
    expect(monitor.reset).toBeInstanceOf(Function);
  });

  it("should track operation timing", () => {
    const monitor = useOperationMonitor();

    monitor.startOperation("test-operation");
    const elapsed = monitor.endOperation("test-operation");

    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it("should return 0 for unknown operation", () => {
    const monitor = useOperationMonitor();

    const elapsed = monitor.endOperation("unknown-operation");

    expect(elapsed).toBe(0);
  });

  it("should track multiple operations", () => {
    const monitor = useOperationMonitor();

    monitor.startOperation("op1");
    monitor.endOperation("op1");

    monitor.startOperation("op2");
    monitor.endOperation("op2");

    const metrics = monitor.getMetrics();
    expect(metrics.operationCount).toBe(2);
  });

  it("should track last operation", () => {
    const monitor = useOperationMonitor();

    monitor.startOperation("first-op");
    monitor.endOperation("first-op");

    monitor.startOperation("last-op");
    monitor.endOperation("last-op");

    const metrics = monitor.getMetrics();
    expect(metrics.lastOperation).toBe("last-op");
  });

  it("should reset metrics", () => {
    const monitor = useOperationMonitor();

    monitor.startOperation("op1");
    monitor.endOperation("op1");

    monitor.reset();

    const metrics = monitor.getMetrics();
    expect(metrics.operationCount).toBe(0);
    expect(metrics.lastOperation).toBe("");
    expect(metrics.renderTime).toBe(0);
  });
});

describe("useReactivePerformanceMonitor", () => {
  it("should create reactive performance monitor", () => {
    // Since useReactivePerformanceMonitor is exported but may not be fully tested
    // due to its reactive nature, we just verify the export exists
    expect(useReactivePerformanceMonitor).toBeInstanceOf(Function);
  });

  it("should have correct function signature", () => {
    // Verify it accepts two arguments (getter and setter)
    expect(useReactivePerformanceMonitor.length).toBe(2);
  });

  it("should return a PerformanceMonitor interface", () => {
    const mockGetter = () => ({
      renderTime: 0,
      operationCount: 0,
      lastOperation: "",
      customMetrics: {},
    });
    const mockSetter = vi.fn();

    const monitor = useReactivePerformanceMonitor(mockGetter, mockSetter);

    expect(monitor).toHaveProperty("startMeasure");
    expect(monitor).toHaveProperty("endMeasure");
    expect(monitor).toHaveProperty("getMetrics");
    expect(monitor).toHaveProperty("reset");
    expect(monitor).toHaveProperty("setCustomMetric");
  });
});
