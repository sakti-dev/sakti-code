import { RetryPart } from "@/views/workspace-view/chat-area/parts/retry-part";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRetryPart } from "../../../../../fixtures/part-fixtures";

describe("RetryPart", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it("renders retry message and attempt from fixture", () => {
    const part = createRetryPart({
      attempt: 2,
      error: {
        message: "Temporary upstream disconnect",
        isRetryable: true,
      },
    });

    ({ unmount: dispose } = render(() => <RetryPart part={part} />, { container }));

    expect(container.querySelector('[data-component="retry-part"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="retry-attempt"]')?.textContent).toContain("#2");
    expect(container.querySelector('[data-slot="retry-message"]')?.textContent).toContain(
      "Temporary upstream disconnect"
    );
  });

  it("renders error kind metadata when present", () => {
    const part = createRetryPart({
      error: {
        message: "Cannot connect to API: other side closed",
        isRetryable: true,
        metadata: { kind: "socket_closed" },
      },
    });

    ({ unmount: dispose } = render(() => <RetryPart part={part} />, { container }));

    expect(container.querySelector('[data-slot="retry-kind"]')?.textContent).toContain(
      "socket_closed"
    );
  });

  it("falls back to default message for malformed payload", () => {
    const part = createRetryPart({ error: undefined, message: undefined, next: undefined });

    ({ unmount: dispose } = render(() => <RetryPart part={part} />, { container }));

    expect(container.querySelector('[data-slot="retry-message"]')?.textContent).toContain(
      "Retrying after transient upstream issue"
    );
    expect(container.querySelector('[data-slot="retry-countdown"]')?.textContent).toContain(
      "retrying shortly"
    );
  });

  it("renders live retry countdown from next timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T00:00:00.000Z"));
    const part = createRetryPart({
      next: Date.now() + 3100,
    });

    ({ unmount: dispose } = render(() => <RetryPart part={part} />, { container }));

    expect(container.querySelector('[data-slot="retry-countdown"]')?.textContent).toContain(
      "in 4s"
    );
    vi.advanceTimersByTime(1100);
    expect(container.querySelector('[data-slot="retry-countdown"]')?.textContent).toContain(
      "in 3s"
    );

    vi.advanceTimersByTime(3000);
    expect(container.querySelector('[data-slot="retry-countdown"]')?.textContent).toContain(
      "retrying now"
    );
  });

  it("formats long countdown using minutes and seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T00:00:00.000Z"));
    const part = createRetryPart({
      next: Date.now() + 96_000,
    });

    ({ unmount: dispose } = render(() => <RetryPart part={part} />, { container }));

    expect(container.querySelector('[data-slot="retry-countdown"]')?.textContent).toContain(
      "retrying in 1m 36s"
    );
  });

  it("shows deterministic now-state for stale next timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T00:00:00.000Z"));
    const part = createRetryPart({
      next: Date.now() - 1_000,
    });

    ({ unmount: dispose } = render(() => <RetryPart part={part} />, { container }));

    expect(container.querySelector('[data-slot="retry-countdown"]')?.textContent).toContain(
      "retrying now"
    );
  });
});
