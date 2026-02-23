import { createAutoScroll } from "@/core/shared/utils/create-auto-scroll";
import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createAutoScroll", () => {
  const originalRaf = window.requestAnimationFrame;
  const originalCancelRaf = window.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    window.requestAnimationFrame = cb => window.setTimeout(() => cb(performance.now()), 0);
    window.cancelAnimationFrame = id => window.clearTimeout(id);
  });

  afterEach(() => {
    vi.useRealTimers();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  });

  it("does not use interval polling for working state changes", () => {
    const intervalSpy = vi.spyOn(window, "setInterval");

    createRoot(dispose => {
      const [working] = createSignal(false);
      createAutoScroll({ working });
      dispose();
    });

    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });

  it("scrolls to bottom when work starts", () => {
    createRoot(dispose => {
      const [working, setWorking] = createSignal(false);
      const autoScroll = createAutoScroll({ working });
      const scrollTo = vi.fn();
      const el = {
        scrollHeight: 1000,
        scrollTop: 0,
        clientHeight: 400,
        scrollTo,
      } as unknown as HTMLElement;
      autoScroll.scrollRef(el);

      vi.advanceTimersByTime(0);

      setWorking(true);
      vi.advanceTimersByTime(0);

      expect(scrollTo).toHaveBeenCalled();
      dispose();
    });
  });

  it("disables auto-scroll when user scrolls far from bottom during work", () => {
    createRoot(dispose => {
      const [working] = createSignal(true);
      const autoScroll = createAutoScroll({ working, settlingPeriod: 50 });
      const el = {
        scrollHeight: 2000,
        scrollTop: 450,
        clientHeight: 400,
        scrollTo: vi.fn(),
      } as unknown as HTMLElement;
      autoScroll.scrollRef(el);

      autoScroll.handleScroll(el);
      vi.advanceTimersByTime(60);
      vi.advanceTimersByTime(0);

      expect(autoScroll.isAutoScrolling()).toBe(false);
      dispose();
    });
  });
});
