/**
 * createAutoScroll - Smart auto-scroll hook for chat interfaces
 *
 * Features:
 * - Distinguish user scroll from auto-scroll
 * - Pause auto-scroll when user scrolls up
 * - Resume when near bottom
 * - 300ms settling period for scroll detection
 * - Visual indicator when auto-scroll is paused
 *
 * @example
 * ```tsx
 * const autoScroll = createAutoScroll({
 *   working: () => isGenerating(),
 * });
 *
 * <div ref={autoScroll.scrollRef} onScroll={autoScroll.handleScroll}>
 *   {/* messages *\/}
 * </div>
 * <Show when={!autoScroll.isAutoScrolling()}>
 *   <button onClick={autoScroll.scrollToBottom}>Scroll to bottom</button>
 * </Show>
 * ```
 */

import { createSignal, onCleanup, onMount } from "solid-js";

interface CreateAutoScrollOptions {
  /** Whether the AI is currently working/generating */
  working: () => boolean;
  /** Distance from bottom (in px) to consider "near bottom" */
  nearBottomDistance?: number;
  /** Settling period (in ms) to wait before detecting user scroll */
  settlingPeriod?: number;
}

interface CreateAutoScrollReturn {
  /** Ref for the scroll container */
  scrollRef: (el: HTMLElement) => void;
  /** Whether auto-scroll is currently enabled */
  isAutoScrolling: () => boolean;
  /** Handler for scroll events */
  handleScroll: (el: HTMLElement) => void;
  /** Manually scroll to bottom */
  scrollToBottom: (smooth?: boolean) => void;
  /** Manually enable/disable auto-scroll */
  setAutoScrolling: (enabled: boolean) => void;
}

export function createAutoScroll(options: CreateAutoScrollOptions): CreateAutoScrollReturn {
  const [isAutoScrolling, setIsAutoScrolling] = createSignal(true);
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();

  const nearBottomDistance = options.nearBottomDistance ?? 100;
  const settlingPeriod = options.settlingPeriod ?? 300;

  let settlingTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastScrollTime = 0;
  let lastScrollTop = 0;

  const isNearBottom = (el: HTMLElement): boolean => {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < nearBottomDistance;
  };

  const scrollToBottom = (smooth = true) => {
    const el = scrollRef();
    if (!el || !isAutoScrolling()) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  };

  const handleScroll = (el: HTMLElement) => {
    const now = Date.now();
    const _timeSinceLastScroll = now - lastScrollTime;
    lastScrollTime = now;

    // Check if this was a programmatic scroll (large jump, likely scrollIntoView)
    const scrollDelta = Math.abs(el.scrollTop - lastScrollTop);
    lastScrollTop = el.scrollTop;

    // Large jumps are likely programmatic, not user scroll
    if (scrollDelta > 500) return;

    // Clear existing timeout
    if (settlingTimeout) {
      clearTimeout(settlingTimeout);
    }

    // Set new timeout to detect if user has stopped scrolling
    settlingTimeout = setTimeout(() => {
      // After settling period, check if we're near bottom
      const nearBottom = isNearBottom(el);

      // Only update if not working (generating)
      // When working, we want to maintain auto-scroll unless user explicitly scrolled up
      if (!options.working()) {
        setIsAutoScrolling(nearBottom);
      } else {
        // When working, only disable if user scrolled significantly up
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setIsAutoScrolling(distanceFromBottom < 300);
      }
    }, settlingPeriod);
  };

  // Auto-scroll to bottom when working state changes to true
  const setupAutoScrollTrigger = () => {
    let lastWorkingState = options.working();

    const interval = setInterval(() => {
      const currentState = options.working();

      // Just started working - scroll to bottom
      if (currentState && !lastWorkingState) {
        setIsAutoScrolling(true);
        setTimeout(() => scrollToBottom(true), 50);
      }

      lastWorkingState = currentState;
    }, 100);

    onCleanup(() => clearInterval(interval));
  };

  onMount(setupAutoScrollTrigger);

  return {
    scrollRef: (el: HTMLElement) => {
      setScrollRef(el);
      // Initial scroll to bottom
      setTimeout(() => scrollToBottom(false), 0);
    },
    isAutoScrolling,
    handleScroll,
    scrollToBottom,
    setAutoScrolling: setIsAutoScrolling,
  };
}

export default createAutoScroll;
