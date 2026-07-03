import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { ThinkingMessagePart } from "../thinking-helpers.ts";
import { ThinkingStep } from "../thinking-step.tsx";

const thoughtForRegex = /Thought for \d+s/;

function renderThinking(
  part: Partial<ThinkingMessagePart> & { type?: "thinking" },
  opts: { isStreaming?: boolean; isLast?: boolean } = {},
) {
  const fullPart = {
    type: "thinking" as const,
    text: "thinking",
    ...part,
  };
  return render(() => (
    <ThinkingStep
      isLast={opts.isLast ?? false}
      isStreaming={opts.isStreaming ?? false}
      part={fullPart}
    />
  ));
}

describe("ThinkingStep", () => {
  it("renders 'Thinking...' while streaming and last item", () => {
    renderThinking(
      { text: "Let me think", startedAt: Date.now() },
      { isStreaming: true, isLast: true },
    );
    expect(screen.getByText("Thinking...")).toBeTruthy();
  });

  it("renders 'Thought for Xs' when endedAt set", () => {
    renderThinking({ text: "hmm", startedAt: Date.now() - 5000, endedAt: Date.now() });
    expect(screen.getByText(thoughtForRegex)).toBeTruthy();
  });

  it("expanded when streaming + last item", () => {
    const { container } = renderThinking(
      { text: "thinking", startedAt: Date.now() },
      { isStreaming: true, isLast: true },
    );
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("collapsed when not streaming", () => {
    const { container } = renderThinking({ text: "hmm", startedAt: 1, endedAt: 2 });
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("collapsed when streaming but NOT last item", () => {
    const { container } = renderThinking(
      { text: "hmm", startedAt: Date.now() },
      { isStreaming: true, isLast: false },
    );
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("toggles on click", () => {
    const { container } = renderThinking({ text: "deep", startedAt: 1, endedAt: 2 });
    const trigger = container.querySelector("[data-slot='collapsible-trigger']") as HTMLElement;
    const content = () =>
      container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content().style.getPropertyValue("grid-template-rows")).toBe("0fr");
    trigger.click();
    expect(content().style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });
});
