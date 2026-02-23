import { createStreamUpdateCoalescer } from "@/core/chat/services/stream-update-coalescer";
import { describe, expect, it, vi } from "vitest";

describe("createStreamUpdateCoalescer", () => {
  it("coalesces updates by key and keeps latest payload", async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const coalescer = createStreamUpdateCoalescer<{ id: string; value: string }>(apply, {
      frameMs: 16,
      getKey: update => update.id,
    });

    coalescer.enqueue({ id: "a", value: "1" });
    coalescer.enqueue({ id: "a", value: "2" });
    coalescer.enqueue({ id: "b", value: "x" });

    expect(apply).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(16);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toEqual([
      { id: "a", value: "2" },
      { id: "b", value: "x" },
    ]);
    vi.useRealTimers();
  });

  it("flushes buffered updates before immediate updates", () => {
    const apply = vi.fn();
    const coalescer = createStreamUpdateCoalescer<{ id: string; value: string }>(apply, {
      frameMs: 16,
      getKey: update => update.id,
    });

    coalescer.enqueue({ id: "a", value: "buffered" });
    coalescer.enqueueImmediate({ id: "b", value: "immediate" });

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0][0]).toEqual([{ id: "a", value: "buffered" }]);
    expect(apply.mock.calls[1][0]).toEqual([{ id: "b", value: "immediate" }]);
  });

  it("can flush synchronously", () => {
    const apply = vi.fn();
    const coalescer = createStreamUpdateCoalescer<{ id: string; value: string }>(apply, {
      frameMs: 16,
      getKey: update => update.id,
    });

    coalescer.enqueue({ id: "a", value: "v1" });
    coalescer.enqueue({ id: "a", value: "v2" });
    coalescer.flush();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toEqual([{ id: "a", value: "v2" }]);
    expect(coalescer.getPendingCount()).toBe(0);
  });
});
