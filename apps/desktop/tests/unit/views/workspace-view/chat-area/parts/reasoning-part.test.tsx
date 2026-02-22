import { ReasoningPart } from "@/views/workspace-view/chat-area/parts/reasoning-part";
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ReasoningPart", () => {
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

  it("renders reasoning text inline", async () => {
    const part = {
      type: "reasoning",
      text: "Let me think about this step by step...",
    };

    ({ unmount: dispose } = render(() => <ReasoningPart part={part} />, { container }));

    // Wait for async rendering
    await vi.waitFor(() => {
      const content = container.querySelector('[data-slot="reasoning-content"]');
      expect(content?.textContent).toContain("step");
    });
  });

  it("renders nothing when text is empty", () => {
    const part = {
      type: "reasoning",
      text: "",
    };

    ({ unmount: dispose } = render(() => <ReasoningPart part={part} />, { container }));

    const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
    expect(reasoningPart).toBeNull();
  });

  it("renders nothing when text is whitespace only", () => {
    const part = {
      type: "reasoning",
      text: "   ",
    };

    ({ unmount: dispose } = render(() => <ReasoningPart part={part} />, { container }));

    const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
    expect(reasoningPart).toBeNull();
  });

  it("uses throttled text during streaming", async () => {
    vi.useFakeTimers();

    const [part, setPart] = createSignal({
      type: "reasoning",
      text: "Initial thought",
    });

    ({ unmount: dispose } = render(() => <ReasoningPart part={part()} isStreaming={true} />, {
      container,
    }));

    // Wait for initial render
    await vi.waitFor(() => {
      const content = container.querySelector('[data-slot="reasoning-content"]');
      expect(content?.textContent).toContain("Initial thought");
    });

    // Rapid updates
    setPart({ type: "reasoning", text: "Updated thought 1" });
    setPart({ type: "reasoning", text: "Updated thought 2" });
    setPart({ type: "reasoning", text: "Final thought" });

    // After throttle + markdown cadence period
    await vi.advanceTimersByTimeAsync(360);

    vi.useRealTimers();

    await vi.waitFor(() => {
      const content = container.querySelector('[data-slot="reasoning-content"]');
      expect(content?.textContent).toContain("Final thought");
    });
  });

  it("renders markdown while streaming without plain-text fallback node", async () => {
    const part = {
      type: "reasoning",
      text: "Streaming thought",
    };

    ({ unmount: dispose } = render(() => <ReasoningPart part={part} isStreaming={true} />, {
      container,
    }));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Streaming thought");
      const markdownNode = container.querySelector('[data-component="markdown"]');
      expect(markdownNode).not.toBeNull();
    });

    const streamingNode = container.querySelector('[data-slot="reasoning-part-streaming"]');
    expect(streamingNode).toBeNull();
  });

  it("applies subtle/italic styling on content", async () => {
    const part = {
      type: "reasoning",
      text: "Thinking out loud",
    };

    ({ unmount: dispose } = render(() => <ReasoningPart part={part} />, { container }));

    // Wait for render
    await vi.waitFor(() => {
      const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
      expect(reasoningPart).not.toBeNull();
    });

    const content = container.querySelector('[data-slot="reasoning-content"]');
    expect(content?.className).toMatch(/italic/);
  });

  it("applies data-component attribute", async () => {
    const part = {
      type: "reasoning",
      text: "Some reasoning",
    };

    ({ unmount: dispose } = render(() => <ReasoningPart part={part} />, { container }));

    await vi.waitFor(() => {
      const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
      expect(reasoningPart).not.toBeNull();
    });
  });

  it("applies custom class", async () => {
    const part = {
      type: "reasoning",
      text: "Some reasoning",
    };

    ({ unmount: dispose } = render(() => <ReasoningPart part={part} class="custom-class" />, {
      container,
    }));

    await vi.waitFor(() => {
      const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
      expect(reasoningPart?.classList.contains("custom-class")).toBe(true);
    });
  });

  it("does not render a collapsible trigger label", () => {
    const part = {
      type: "reasoning",
      text: "Some reasoning",
    };

    ({ unmount: dispose } = render(() => <ReasoningPart part={part} />, { container }));

    expect(container.querySelector('[data-slot="reasoning-trigger"]')).toBeNull();
    expect(container.textContent).not.toContain("Thinking");
  });
});
