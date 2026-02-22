import { TextPart } from "@/views/workspace-view/chat-area/parts/text-part";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accumulateDeltas,
  createRecordedTextDeltaSequence,
} from "../../../../../fixtures/performance-fixtures";

describe("TextPart", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("renders text content via Markdown", async () => {
    const part = {
      type: "text",
      text: "Hello **world**",
    };

    ({ unmount: dispose } = render(() => <TextPart part={part} />, { container }));

    // Wait for Markdown async rendering
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Hello");
    });
    expect(container.textContent).toContain("world");
  });

  it("renders nothing when text is empty", () => {
    const part = {
      type: "text",
      text: "",
    };

    ({ unmount: dispose } = render(() => <TextPart part={part} />, { container }));

    // TextPart should render nothing when empty - component not rendered at all
    const textPart = container.querySelector('[data-component="text-part"]');
    expect(textPart).toBeNull();
  });

  it("renders nothing when text is whitespace only", () => {
    const part = {
      type: "text",
      text: "   ",
    };

    ({ unmount: dispose } = render(() => <TextPart part={part} />, { container }));

    // TextPart should render nothing when whitespace only
    const textPart = container.querySelector('[data-component="text-part"]');
    expect(textPart).toBeNull();
  });

  it("uses throttled text during streaming", async () => {
    vi.useFakeTimers();

    const [part, setPart] = createSignal({
      type: "text",
      text: "Initial text",
    });

    ({ unmount: dispose } = render(() => <TextPart part={part()} isStreaming={true} />, {
      container,
    }));

    // Wait for initial render
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Initial text");
    });

    // Rapid updates
    setPart({ type: "text", text: "Updated 1" });
    setPart({ type: "text", text: "Updated 2" });
    setPart({ type: "text", text: "Final update" });

    // After throttle + markdown cadence period - should show final value
    await vi.advanceTimersByTimeAsync(360);

    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Final update");
    });
  });

  it("renders markdown while streaming without plain-text fallback node", async () => {
    const part = {
      type: "text",
      text: "Streaming plain text",
    };

    ({ unmount: dispose } = render(() => <TextPart part={part} isStreaming={true} />, {
      container,
    }));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Streaming plain text");
      const markdownNode = container.querySelector('[data-component="markdown"]');
      expect(markdownNode).not.toBeNull();
    });

    const streamingNode = container.querySelector('[data-slot="text-part-streaming"]');
    expect(streamingNode).toBeNull();
  });

  it("throttles fixture-based recorded stream deltas smoothly", async () => {
    vi.useFakeTimers();

    const deltas = createRecordedTextDeltaSequence(16);
    const [part, setPart] = createSignal({
      type: "text",
      text: "",
    });

    ({ unmount: dispose } = render(() => <TextPart part={part()} isStreaming={true} />, {
      container,
    }));

    setPart({ type: "text", text: deltas[0] ?? "" });
    for (let i = 1; i < deltas.length; i++) {
      setPart({ type: "text", text: accumulateDeltas(deltas.slice(0, i + 1)) });
    }

    vi.advanceTimersByTime(40);
    const beforeFlush = container.textContent ?? "";
    expect(beforeFlush).not.toContain(accumulateDeltas(deltas));

    vi.advanceTimersByTime(100);
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(container.textContent).toContain(accumulateDeltas(deltas));
    });
  });

  it("shows copy button on hover state", () => {
    const part = {
      type: "text",
      text: "Copyable text",
    };

    ({ unmount: dispose } = render(() => <TextPart part={part} />, { container }));

    // Copy button should be present (with opacity-0 for hover effect)
    const copyButton = container.querySelector('[data-slot="text-part-copy"]');
    expect(copyButton).not.toBeNull();
  });

  it("updates copy button to Copied after click", async () => {
    // Mock clipboard API
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    const part = {
      type: "text",
      text: "Copyable text",
    };

    ({ unmount: dispose } = render(() => <TextPart part={part} />, { container }));

    // Wait for render
    await vi.waitFor(() => {
      const copyButton = container.querySelector('[data-slot="text-part-copy"]');
      expect(copyButton).not.toBeNull();
    });

    const copyButton = container.querySelector('[data-slot="text-part-copy"]');
    expect(copyButton?.textContent).toContain("Copy");

    // Click copy button
    copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Wait for clipboard operation
    await vi.waitFor(() => {
      const button = container.querySelector('[data-slot="text-part-copy"]');
      expect(button?.textContent).toContain("Copied");
    });

    expect(mockWriteText).toHaveBeenCalledWith("Copyable text");
  });

  it("applies data-component attribute", async () => {
    const part = {
      type: "text",
      text: "Test content",
    };

    ({ unmount: dispose } = render(() => <TextPart part={part} />, { container }));

    // Wait for render
    await vi.waitFor(() => {
      const textPart = container.querySelector('[data-component="text-part"]');
      expect(textPart).not.toBeNull();
    });
  });

  it("applies custom class", async () => {
    const part = {
      type: "text",
      text: "Test content",
    };

    ({ unmount: dispose } = render(() => <TextPart part={part} class="custom-class" />, {
      container,
    }));

    // Wait for render
    await vi.waitFor(() => {
      const textPart = container.querySelector('[data-component="text-part"]');
      expect(textPart?.classList.contains("custom-class")).toBe(true);
    });
  });
});
