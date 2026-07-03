import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { ToolCallPart } from "../timeline-grouping.ts";
import { ExploreStep } from "../explore-step.tsx";

const makeRead = (id: string, file: string): ToolCallPart => ({
  input: { file_path: file },
  status: "done",
  toolCallId: id,
  toolName: "read",
  type: "tool_call",
});

describe("ExploreStep", () => {
  it("renders 'Explored N files' label", () => {
    render(() => (
      <ExploreStep
        isLast={false}
        isStreaming={false}
        parts={[makeRead("r1", "a.ts"), makeRead("r2", "b.ts"), makeRead("r3", "c.ts")]}
      />
    ));
    expect(screen.getByText(/Explored 3 files/)).toBeTruthy();
  });

  it("expanded when streaming + last item", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={true}
        isStreaming={true}
        parts={[makeRead("r1", "a"), makeRead("r2", "b")]}
      />
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("collapsed when not streaming", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={true}
        isStreaming={false}
        parts={[makeRead("r1", "a"), makeRead("r2", "b")]}
      />
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("collapsed when streaming but NOT last", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={false}
        isStreaming={true}
        parts={[makeRead("r1", "a"), makeRead("r2", "b")]}
      />
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("toggles on click", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={false}
        isStreaming={false}
        parts={[makeRead("r1", "a"), makeRead("r2", "b")]}
      />
    ));
    const trigger = container.querySelector("[data-slot='collapsible-trigger']") as HTMLElement;
    const content = () =>
      container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content().style.getPropertyValue("grid-template-rows")).toBe("0fr");
    trigger.click();
    expect(content().style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("renders sub-item summaries when expanded", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={false}
        isStreaming={false}
        parts={[makeRead("r1", "button.tsx"), makeRead("r2", "card.tsx")]}
      />
    ));
    (container.querySelector("[data-slot='collapsible-trigger']") as HTMLElement).click();
    expect(container.querySelectorAll("[data-component='tool-summary-row']").length).toBe(2);
  });
});
