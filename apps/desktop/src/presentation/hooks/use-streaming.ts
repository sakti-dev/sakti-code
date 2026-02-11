/**
 * useStreaming Hook
 *
 * Manages streaming state for chat operations.
 * Provides reactive state for connecting, streaming, done, and error states.
 *
 * Part of Phase 5: Hooks Refactor
 *
 * @example
 * ```tsx
 * function ChatComponent() {
 *   const streaming = useStreaming();
 *
 *   return (
 *     <div>
 *       {streaming.isLoading() && <Spinner />}
 *       <button onClick={streaming.start}>Send</button>
 *     </div>
 *   );
 * }
 * ```
 */

import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { createLogger } from "../../lib/logger";

const logger = createLogger("desktop:hooks:use-streaming");

/**
 * Streaming status states
 */
export type StreamingStatus = "idle" | "connecting" | "streaming" | "done" | "error";

/**
 * Streaming state interface
 */
export interface StreamingState {
  status: StreamingStatus;
  error: Error | null;
  activeMessageId: string | null;
}

/**
 * Result returned by useStreaming hook
 */
export interface UseStreamingResult {
  /** Current status */
  status: Accessor<StreamingStatus>;

  /** Current error (if any) */
  error: Accessor<Error | null>;

  /** Active message ID being streamed */
  activeMessageId: Accessor<string | null>;

  /** Whether currently loading (connecting or streaming) */
  isLoading: Accessor<boolean>;

  /** Whether can send (idle, done, or error) */
  canSend: Accessor<boolean>;

  /** Start streaming */
  start: (messageId?: string) => void;

  /** Set streaming status */
  setStatus: (status: StreamingStatus) => void;

  /** Set error state */
  setError: (error: Error | null) => void;

  /** Complete streaming */
  complete: (messageId?: string) => void;

  /** Stop/abort streaming */
  stop: () => void;

  /** Reset to idle state */
  reset: () => void;
}

/**
 * Hook for managing streaming state
 *
 * Features:
 * - Reactive state management for streaming operations
 * - Proper cleanup with onCleanup
 * - Error handling
 * - Active message tracking
 */
export function useStreaming(): UseStreamingResult {
  const [status, setStatus] = createSignal<StreamingStatus>("idle");
  const [error, setError] = createSignal<Error | null>(null);
  const [activeMessageId, setActiveMessageId] = createSignal<string | null>(null);

  // Derived state
  const isLoading = createMemo(() => {
    const s = status();
    return s === "connecting" || s === "streaming";
  });

  const canSend = createMemo(() => {
    const s = status();
    return s === "idle" || s === "done" || s === "error";
  });

  /**
   * Start streaming operation
   */
  const start = (messageId?: string) => {
    logger.debug("Starting streaming", { messageId });
    setStatus("connecting");
    setError(null);
    if (messageId) {
      setActiveMessageId(messageId);
    }
  };

  /**
   * Complete streaming operation
   */
  const complete = (messageId?: string) => {
    logger.debug("Completing streaming", { messageId, currentActive: activeMessageId() });
    setStatus("done");
    if (messageId) {
      setActiveMessageId(messageId);
    }
  };

  /**
   * Stop/abort streaming operation
   */
  const stop = () => {
    logger.debug("Stopping streaming", { activeMessageId: activeMessageId() });
    setStatus("idle");
    setError(null);
    setActiveMessageId(null);
  };

  /**
   * Reset to initial state
   */
  const reset = () => {
    logger.debug("Resetting streaming state");
    setStatus("idle");
    setError(null);
    setActiveMessageId(null);
  };

  /**
   * Cleanup on unmount
   */
  onCleanup(() => {
    logger.debug("useStreaming cleanup");
    // Reset state to prevent memory leaks
    reset();
  });

  return {
    status,
    error,
    activeMessageId,
    isLoading,
    canSend,
    start,
    setStatus,
    setError,
    complete,
    stop,
    reset,
  };
}
