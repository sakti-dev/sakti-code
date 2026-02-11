/**
 * SolidJS Reactive Performance Monitoring Utilities
 *
 * Provides reactive performance tracking hooks for SolidJS components.
 * Part of Phase 6: Cleanup & Optimization
 */

import { onCleanup, onMount } from "solid-js";
import type { PerformanceMonitor } from "./performance";

export interface RenderMonitorState {
  /** Number of times the component has rendered */
  renderCount: () => number;
  /** Time of the last render in milliseconds */
  lastRenderTime: () => number;
}

export interface OperationMonitorResult {
  /** Start measuring an operation */
  startOperation: (name: string) => void;
  /** End measuring an operation and return elapsed time */
  endOperation: (name: string) => number;
  /** Get current performance metrics */
  getMetrics: () => {
    operationCount: number;
    lastOperation: string;
    renderTime: number;
  };
  /** Reset all metrics */
  reset: () => void;
}

/**
 * Hook to monitor component render performance
 *
 * Tracks render count and render time, logging stats on unmount.
 *
 * @param componentName - Name of the component for logging
 *
 * @example
 * ```tsx
 * const MyComponent = () => {
 *   const monitor = useRenderMonitor('MyComponent');
 *   const [count, setCount] = createSignal(0);
 *
 *   return <div onClick={() => setCount(c => c + 1)}>
 *     Renders: {monitor.renderCount()}
 *   </div>;
 * };
 * ```
 */
export function useRenderMonitor(componentName: string): RenderMonitorState {
  let renderCount = 0;
  let lastRenderTime = 0;
  let mountedTime = 0;

  // Track initial render
  onMount(() => {
    mountedTime = performance.now();
    lastRenderTime = mountedTime;
    renderCount = 1;
  });

  // Log on unmount
  onCleanup(() => {
    const totalTime = performance.now() - mountedTime;
    const avgRenderTime = renderCount > 0 ? totalTime / renderCount : 0;

    console.info(`[RenderMonitor] ${componentName}:`, {
      renderCount,
      totalTime: `${totalTime.toFixed(2)}ms`,
      avgRenderTime: `${avgRenderTime.toFixed(2)}ms`,
    });
  });

  return {
    renderCount: () => renderCount,
    lastRenderTime: () => lastRenderTime,
  };
}

/**
 * Hook to monitor operation performance within a component
 *
 * Uses PerformanceMonitor to track operation timings.
 *
 * @example
 * ```tsx
 * const MyComponent = () => {
 *   const monitor = useOperationMonitor();
 *
 *   const handleClick = () => {
 *     monitor.startOperation('click-handler');
 *     // ... do work ...
 *     const elapsed = monitor.endOperation('click-handler');
 *     console.log(`Operation took ${elapsed}ms`);
 *   };
 *
 *   return <button onClick={handleClick}>Click me</button>;
 * };
 * ```
 */
export function useOperationMonitor(): OperationMonitorResult {
  const operations = new Map<string, number>();

  let operationCount = 0;
  let lastOperation = "";
  let totalRenderTime = 0;

  const startOperation = (name: string): void => {
    operations.set(name, performance.now());
  };

  const endOperation = (name: string): number => {
    const start = operations.get(name);
    if (start === undefined) return 0;

    const elapsed = performance.now() - start;
    operations.delete(name);

    // Update metrics
    operationCount += 1;
    lastOperation = name;
    totalRenderTime += elapsed;

    return elapsed;
  };

  const getMetrics = () => ({
    operationCount,
    lastOperation,
    renderTime: totalRenderTime,
  });

  const reset = (): void => {
    operations.clear();
    operationCount = 0;
    lastOperation = "";
    totalRenderTime = 0;
  };

  return {
    startOperation,
    endOperation,
    getMetrics,
    reset,
  };
}

/**
 * Create a reactive performance monitor that integrates with SolidJS
 *
 * Combines createPerformanceMonitor with reactive state updates.
 *
 * @example
 * ```tsx
 * const [metrics, setMetrics] = createSignal<PerformanceMetrics>({
 *   renderTime: 0,
 *   operationCount: 0,
 *   lastOperation: '',
 *   customMetrics: {},
 * });
 *
 * const monitor = useReactivePerformanceMonitor(metrics, setMetrics);
 *
 * monitor.startMeasure('operation');
 * // ... work ...
 * monitor.endMeasure('operation');
 * // metrics signal is automatically updated
 * ```
 */
export function useReactivePerformanceMonitor(
  getMetrics: () => import("./performance").PerformanceMetrics,
  setMetrics: (value: import("./performance").PerformanceMetrics) => void
): PerformanceMonitor {
  const operations = new Map<string, number>();

  const startMeasure = (name: string): void => {
    operations.set(name, performance.now());
  };

  const endMeasure = (name: string): number => {
    const start = operations.get(name);
    if (start === undefined) return 0;

    const elapsed = performance.now() - start;
    operations.delete(name);

    // Update reactive state
    const current = getMetrics();
    setMetrics({
      ...current,
      renderTime: current.renderTime + elapsed,
      operationCount: current.operationCount + 1,
      lastOperation: name,
    });

    return elapsed;
  };

  const getMetricsCopy = () => getMetrics();

  const reset = (): void => {
    operations.clear();
    setMetrics({
      renderTime: 0,
      operationCount: 0,
      lastOperation: "",
      customMetrics: {},
    });
  };

  const setCustomMetric = (name: string, value: number): void => {
    const current = getMetrics();
    setMetrics({
      ...current,
      customMetrics: {
        ...current.customMetrics,
        [name]: value,
      },
    });
  };

  return {
    startMeasure,
    endMeasure,
    getMetrics: getMetricsCopy,
    reset,
    setCustomMetric,
  };
}
