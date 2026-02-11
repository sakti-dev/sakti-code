/**
 * Performance Monitoring Utilities
 *
 * Provides performance tracking for operations with timing measurements.
 * Part of Phase 6: Cleanup & Optimization
 */

export interface PerformanceMetrics {
  /** Total render time accumulated across operations */
  renderTime: number;
  /** Number of operations tracked */
  operationCount: number;
  /** Name of the last operation measured */
  lastOperation: string;
  /** Custom metrics for specific use cases */
  customMetrics: Record<string, number>;
}

export interface PerformanceMonitor {
  /** Start measuring an operation by name */
  startMeasure: (name: string) => void;
  /** End measuring and return elapsed time in milliseconds */
  endMeasure: (name: string) => number;
  /** Get current performance metrics */
  getMetrics: () => PerformanceMetrics;
  /** Reset all metrics and tracked operations */
  reset: () => void;
  /** Set a custom metric value */
  setCustomMetric: (name: string, value: number) => void;
}

/**
 * Create a performance monitor for tracking operation timings
 *
 * @example
 * ```ts
 * const monitor = createPerformanceMonitor();
 *
 * monitor.startMeasure('render');
 * // ... do work ...
 * const elapsed = monitor.endMeasure('render');
 * console.log(`Render took ${elapsed}ms`);
 *
 * const metrics = monitor.getMetrics();
 * console.log(`Total operations: ${metrics.operationCount}`);
 * ```
 */
export function createPerformanceMonitor(): PerformanceMonitor {
  const operations = new Map<string, number>();
  const customMetrics: Record<string, number> = {};

  let totalRenderTime = 0;
  let operationCount = 0;
  let lastOperation = "";

  const startMeasure = (name: string): void => {
    operations.set(name, performance.now());
  };

  const endMeasure = (name: string): number => {
    const start = operations.get(name);
    if (start === undefined) return 0;

    const elapsed = performance.now() - start;
    operations.delete(name);

    // Update metrics
    totalRenderTime += elapsed;
    operationCount += 1;
    lastOperation = name;

    return elapsed;
  };

  const getMetrics = (): PerformanceMetrics => ({
    renderTime: totalRenderTime,
    operationCount,
    lastOperation,
    customMetrics: { ...customMetrics },
  });

  const reset = (): void => {
    operations.clear();
    totalRenderTime = 0;
    operationCount = 0;
    lastOperation = "";
    Object.keys(customMetrics).forEach(key => {
      delete customMetrics[key];
    });
  };

  const setCustomMetric = (name: string, value: number): void => {
    customMetrics[name] = value;
  };

  return {
    startMeasure,
    endMeasure,
    getMetrics,
    reset,
    setCustomMetric,
  };
}
