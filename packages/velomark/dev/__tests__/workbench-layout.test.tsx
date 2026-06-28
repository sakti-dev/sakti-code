import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import App from "../app";

describe("playground workbench layout", () => {
  it("renders a compact diagnostics strip instead of separate diagnostic panels", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);

    expect(container.textContent).toContain("Diagnostics");
    expect(container.textContent).not.toContain("DOM Identity");
    expect(container.textContent).not.toContain("Selection Probe");
    expect(container.textContent).not.toContain("BenchmarkMeasure");
    expect(
      container.querySelector(
        '.renderer-surface .markdown-content[data-component="markdown"]'
      )
    ).not.toBeNull();

    const shell = container.querySelector(".playground-shell");
    const workbenchPanel = Array.from(
      container.querySelectorAll("section")
    ).find((section) => section.textContent?.includes("Workbench"));
    const diagnosticsPanel = Array.from(
      container.querySelectorAll("section")
    ).find((section) => section.textContent?.includes("Diagnostics"));
    const rendererPanel = Array.from(
      container.querySelectorAll("section")
    ).find((section) => section.textContent?.includes("Renderer Viewport"));
    const lightButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Light"
    );
    const darkButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Dark"
    );

    expect(shell?.classList.contains("bg-background")).toBe(true);
    expect(shell?.classList.contains("text-foreground")).toBe(true);
    expect(workbenchPanel?.classList.contains("bg-card")).toBe(true);
    expect(workbenchPanel?.classList.contains("border-border")).toBe(true);
    expect(diagnosticsPanel?.classList.contains("bg-card")).toBe(true);
    expect(rendererPanel?.classList.contains("bg-card")).toBe(true);
    expect(lightButton).toBeDefined();
    expect(darkButton).toBeDefined();

    dispose();
    container.remove();
  });
});
