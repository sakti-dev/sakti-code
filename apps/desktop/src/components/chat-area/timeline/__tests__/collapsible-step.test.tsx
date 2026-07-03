import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import { CollapsibleStep } from "../collapsible-step.tsx";

describe("CollapsibleStep", () => {
  it("renders label text", () => {
    render(() => (
      <CollapsibleStep expanded={false} label="Thought for 3s" onToggle={() => {}}>
        <span>C</span>
      </CollapsibleStep>
    ));
    expect(document.body.textContent).toContain("Thought for 3s");
  });

  it("content collapsed (0fr) when expanded=false", () => {
    const { container } = render(() => (
      <CollapsibleStep expanded={false} label="T" onToggle={() => {}}>
        <span>C</span>
      </CollapsibleStep>
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("content expanded (1fr) when expanded=true", () => {
    const { container } = render(() => (
      <CollapsibleStep expanded={true} label="T" onToggle={() => {}}>
        <span>C</span>
      </CollapsibleStep>
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("calls onToggle on click", () => {
    let toggled = false;
    const { container } = render(() => (
      <CollapsibleStep expanded={false} label="T" onToggle={() => (toggled = true)}>
        <span>C</span>
      </CollapsibleStep>
    ));
    (container.querySelector("[data-slot='collapsible-trigger']") as HTMLElement).click();
    expect(toggled).toBe(true);
  });

  it("chevron rotates when expanded", () => {
    const { container } = render(() => (
      <CollapsibleStep expanded={true} label="T" onToggle={() => {}}>
        <span>C</span>
      </CollapsibleStep>
    ));
    const chevron = container.querySelector("[data-slot='collapsible-chevron']") as HTMLElement;
    expect(chevron.classList.contains("rotate-90")).toBe(true);
  });
});
