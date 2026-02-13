/**
 * Chat Utilities Barrel Export
 *
 * Exports chat-specific utility functions.
 * These utilities are used within the chat context including:
 * - Auto-scroll behavior
 * - Message eviction
 * - SSE catchup
 * - Performance monitoring
 *
 * Part of Phase 6: Utility Organization
 */

export { runWithFrameBudget } from "./frame-budget-scheduler";
export type { FrameBudgetRunResult, FrameBudgetSchedulerOptions } from "./frame-budget-scheduler";
export { createPerformanceMonitor } from "./performance";
export type { PerformanceMetrics, PerformanceMonitor } from "./performance";
export {
  useOperationMonitor,
  useReactivePerformanceMonitor,
  useRenderMonitor,
} from "./reactive-performance";
export type { OperationMonitorResult, RenderMonitorState } from "./reactive-performance";

// Note: cn (classnames utility) moved to @/utils
