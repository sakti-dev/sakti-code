import { ReasoningPart } from "@/views/workspace-view/chat-area/parts/reasoning-part";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
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

  it("renders reasoning text when expanded", async () => {
    const part = {
      type: "reasoning",
      text: "Let me think about this step by step...",
    };

    dispose = render(() => <ReasoningPart part={part} defaultOpen={true} />, container);

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

    dispose = render(() => <ReasoningPart part={part} />, container);

    const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
    expect(reasoningPart).toBeNull();
  });

  it("renders nothing when text is whitespace only", () => {
    const part = {
      type: "reasoning",
      text: "   ",
    };

    dispose = render(() => <ReasoningPart part={part} />, container);

    const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
    expect(reasoningPart).toBeNull();
  });

  it("uses throttled text during streaming", async () => {
    vi.useFakeTimers();

    const [part, setPart] = createSignal({
      type: "reasoning",
      text: "Initial thought",
    });

    dispose = render(
      () => <ReasoningPart part={part()} isStreaming={true} defaultOpen={true} />,
      container
    );

    // Wait for initial render
    await vi.waitFor(() => {
      const content = container.querySelector('[data-slot="reasoning-content"]');
      expect(content?.textContent).toContain("Initial thought");
    });

    // Rapid updates
    setPart({ type: "reasoning", text: "Updated thought 1" });
    setPart({ type: "reasoning", text: "Updated thought 2" });
    setPart({ type: "reasoning", text: "Final thought" });

    // Before throttle period
    vi.advanceTimersByTime(50);
    let content = container.querySelector('[data-slot="reasoning-content"]');
    expect(content?.textContent).toContain("Initial thought");

    // After throttle period
    vi.advanceTimersByTime(60);

    vi.useRealTimers();

    await vi.waitFor(() => {
      content = container.querySelector('[data-slot="reasoning-content"]');
      expect(content?.textContent).toContain("Final thought");
    });
  });

  it("applies subtle/italic styling on trigger", async () => {
    const part = {
      type: "reasoning",
      text: "Thinking out loud",
    };

    dispose = render(() => <ReasoningPart part={part} />, container);

    // Wait for render
    await vi.waitFor(() => {
      const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
      expect(reasoningPart).not.toBeNull();
    });

    // Check for italic class on trigger
    const trigger = container.querySelector('[data-slot="reasoning-trigger"]');
    expect(trigger?.className).toMatch(/italic/);
  });

  it("applies data-component attribute", async () => {
    const part = {
      type: "reasoning",
      text: "Some reasoning",
    };

    dispose = render(() => <ReasoningPart part={part} />, container);

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

    dispose = render(() => <ReasoningPart part={part} class="custom-class" />, container);

    await vi.waitFor(() => {
      const reasoningPart = container.querySelector('[data-component="reasoning-part"]');
      expect(reasoningPart?.classList.contains("custom-class")).toBe(true);
    });
  });

  it("shows Thinking trigger label", () => {
    const part = {
      type: "reasoning",
      text: "Some reasoning",
    };

    dispose = render(() => <ReasoningPart part={part} />, container);

    // Trigger should contain "Thinking"
    const trigger = container.querySelector('[data-slot="reasoning-trigger"]');
    expect(trigger?.textContent).toContain("Thinking");
  });

  it("is collapsible", async () => {
    const part = {
      type: "reasoning",
      text: "Some reasoning content to hide",
    };

    dispose = render(() => <ReasoningPart part={part} />, container);

    // Wait for render
    await vi.waitFor(() => {
      const trigger = container.querySelector('[data-slot="reasoning-trigger"]');
      expect(trigger).not.toBeNull();
    });

    // Content should initially be collapsed
    let content = container.querySelector('[data-slot="reasoning-content"]');
    expect(content?.textContent).toBeFalsy();

    // Click to expand
    const trigger = container.querySelector('[data-slot="reasoning-trigger"]');
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Content should now be visible
    await vi.waitFor(() => {
      content = container.querySelector('[data-slot="reasoning-content"]');
      expect(content?.textContent).toContain("Some reasoning content");
    });
  });
});
