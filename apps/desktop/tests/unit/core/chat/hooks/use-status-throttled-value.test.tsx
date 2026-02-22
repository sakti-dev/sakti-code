import { useStatusThrottledValue } from "@/core/chat/hooks/use-status-throttled-value";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("useStatusThrottledValue", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T00:00:00.000Z"));
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it("returns initial status immediately", () => {
    const [value] = createSignal<string | undefined>("Thinking");

    const TestComponent = () => {
      const throttled = useStatusThrottledValue(value, 2500);
      return <span>{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));

    expect(container.textContent).toBe("Thinking");
  });

  it("enforces minimum visible interval between status changes", () => {
    const [value, setValue] = createSignal<string | undefined>("Thinking");

    const TestComponent = () => {
      const throttled = useStatusThrottledValue(value, 2500);
      return <span>{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));

    setValue("Gathering context");
    vi.advanceTimersByTime(1000);

    expect(container.textContent).toBe("Thinking");

    vi.advanceTimersByTime(1500);
    expect(container.textContent).toBe("Gathering context");
  });

  it("applies latest trailing status after the interval window", () => {
    const [value, setValue] = createSignal<string | undefined>("Thinking");

    const TestComponent = () => {
      const throttled = useStatusThrottledValue(value, 2500);
      return <span>{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));

    setValue("Gathering context");
    vi.advanceTimersByTime(300);
    setValue("Running commands");
    vi.advanceTimersByTime(300);
    setValue("Making edits");

    vi.advanceTimersByTime(1800);
    expect(container.textContent).toBe("Thinking");

    vi.advanceTimersByTime(100);
    expect(container.textContent).toBe("Making edits");
  });
});
