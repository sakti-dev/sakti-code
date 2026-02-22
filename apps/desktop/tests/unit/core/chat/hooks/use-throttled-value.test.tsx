import { useThrottledValue } from "@/core/chat/hooks/use-throttled-value";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("useThrottledValue", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.useFakeTimers();
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it("returns initial value immediately", () => {
    const [value] = createSignal("initial");

    const TestComponent = () => {
      const throttled = useThrottledValue(value, 100);
      return <span data-testid="value">{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));

    expect(container.textContent).toBe("initial");
  });

  it("throttles rapid value changes", () => {
    const [value, setValue] = createSignal("initial");

    const TestComponent = () => {
      const throttled = useThrottledValue(value, 100);
      return <span data-testid="value">{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));

    expect(container.textContent).toBe("initial");

    // Rapid changes
    setValue("change1");
    setValue("change2");
    setValue("change3");

    // Still showing initial before throttle period
    expect(container.textContent).toBe("initial");

    // Advance time but not enough
    vi.advanceTimersByTime(50);
    expect(container.textContent).toBe("initial");

    // Advance past throttle period
    vi.advanceTimersByTime(60);
    expect(container.textContent).toBe("change3");
  });

  it("updates to final value after throttle period", () => {
    const [value, setValue] = createSignal("initial");

    const TestComponent = () => {
      const throttled = useThrottledValue(value, 50);
      return <span data-testid="value">{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));

    expect(container.textContent).toBe("initial");

    setValue("updated");

    // Before throttle period
    vi.advanceTimersByTime(25);
    expect(container.textContent).toBe("initial");

    // After throttle period
    vi.advanceTimersByTime(30);
    expect(container.textContent).toBe("updated");
  });

  it("updates immediately when throttle is disabled", () => {
    const [value, setValue] = createSignal("initial");

    const TestComponent = () => {
      const throttled = useThrottledValue(value, 0);
      return <span data-testid="value">{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));

    expect(container.textContent).toBe("initial");
    setValue("updated");
    expect(container.textContent).toBe("updated");
  });

  it("handles numeric values", () => {
    const [value, setValue] = createSignal(0);

    const TestComponent = () => {
      const throttled = useThrottledValue(value, 100);
      return <span data-testid="value">{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));

    expect(container.textContent).toBe("0");

    setValue(42);
    vi.advanceTimersByTime(100);

    expect(container.textContent).toBe("42");
  });

  it("cleans up timeout on unmount", () => {
    const [value, setValue] = createSignal("initial");

    const TestComponent = () => {
      const throttled = useThrottledValue(value, 100);
      return <span data-testid="value">{throttled()}</span>;
    };

    ({ unmount: dispose } = render(() => <TestComponent />, { container }));
    setValue("updated");

    // Dispose before timeout fires
    dispose();
    dispose = () => {};

    // Advance timers - should not throw
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
  });
});
