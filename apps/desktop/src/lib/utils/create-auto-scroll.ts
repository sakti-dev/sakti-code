import { createEffect, createSignal, onCleanup } from "solid-js";

interface CreateAutoScrollOptions {
  nearBottomDistance?: number;
  settlingPeriod?: number;
  working: () => boolean;
}

interface CreateAutoScrollReturn {
  handleScroll: (el: HTMLElement) => void;
  isAutoScrolling: () => boolean;
  scrollRef: (el: HTMLElement) => void;
  scrollToBottom: (smooth?: boolean) => void;
  setAutoScrolling: (enabled: boolean) => void;
}

export function createAutoScroll(
  options: CreateAutoScrollOptions
): CreateAutoScrollReturn {
  const [isAutoScrolling, setIsAutoScrolling] = createSignal(true);
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();

  const nearBottomDistance = options.nearBottomDistance ?? 100;
  const settlingPeriod = options.settlingPeriod ?? 300;

  let settlingTimeout: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | undefined;
  let initialScrollScheduled = false;
  let lastScrollTop = 0;

  const isNearBottom = (el: HTMLElement): boolean => {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < nearBottomDistance;
  };

  const scrollToBottom = (smooth = true) => {
    const el = scrollRef();
    if (!(el && isAutoScrolling())) {
      return;
    }

    if (typeof el.scrollTo === "function") {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
      return;
    }

    el.scrollTop = el.scrollHeight;
  };

  const scheduleRaf = (callback: () => void) => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      callback();
      return;
    }

    if (rafId !== undefined) {
      window.cancelAnimationFrame(rafId);
    }
    rafId = window.requestAnimationFrame(() => {
      rafId = undefined;
      callback();
    });
  };

  const handleScroll = (el: HTMLElement) => {
    const scrollDelta = Math.abs(el.scrollTop - lastScrollTop);
    lastScrollTop = el.scrollTop;

    if (scrollDelta > 500) {
      return;
    }

    if (settlingTimeout) {
      clearTimeout(settlingTimeout);
    }

    settlingTimeout = setTimeout(() => {
      scheduleRaf(() => {
        const nearBottom = isNearBottom(el);

        if (options.working()) {
          const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
          setIsAutoScrolling(distanceFromBottom < 300);
        } else {
          setIsAutoScrolling(nearBottom);
        }
      });
    }, settlingPeriod);
  };

  createEffect<boolean>((previousWorking) => {
    const currentWorking = options.working();
    if (currentWorking && !previousWorking) {
      setIsAutoScrolling(true);
      scheduleRaf(() => scrollToBottom(true));
    }
    return currentWorking;
  }, options.working());

  onCleanup(() => {
    if (settlingTimeout) {
      clearTimeout(settlingTimeout);
      settlingTimeout = undefined;
    }
    if (rafId !== undefined && typeof window !== "undefined") {
      window.cancelAnimationFrame(rafId);
      rafId = undefined;
    }
  });

  return {
    scrollRef: (el: HTMLElement) => {
      setScrollRef(el);
      if (initialScrollScheduled) {
        return;
      }
      initialScrollScheduled = true;
      scheduleRaf(() => scrollToBottom(false));
    },
    isAutoScrolling,
    handleScroll,
    scrollToBottom,
    setAutoScrolling: setIsAutoScrolling,
  };
}
