import { BasicTool, type BasicToolProps } from "@/views/workspace-view/chat-area/tools/basic-tool";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("BasicTool", () => {
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

  it("renders trigger with icon and title", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    expect(container.textContent).toContain("Read File");
    const trigger = container.querySelector('[data-slot="basic-tool-trigger"]');
    expect(trigger).not.toBeNull();
  });

  it("renders subtitle when provided", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File", subtitle: "src/index.ts" },
      icon: "file",
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    expect(container.textContent).toContain("Read File");
    expect(container.textContent).toContain("src/index.ts");
  });

  it("renders args as part of subtitle when provided", () => {
    const props: BasicToolProps = {
      trigger: { title: "Bash", args: "npm run build" },
      icon: "terminal",
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    expect(container.textContent).toContain("Bash");
    expect(container.textContent).toContain("npm run build");
  });

  it("shows collapsible arrow when children present", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      children: <div data-testid="content">Output content</div>,
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    const arrow = container.querySelector('[data-slot="basic-tool-arrow"]');
    expect(arrow).not.toBeNull();
  });

  it("hides arrow when hideDetails is true", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      hideDetails: true,
      children: <div data-testid="content">Output content</div>,
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    const arrow = container.querySelector('[data-slot="basic-tool-arrow"]');
    expect(arrow).toBeNull();
  });

  it("expands and collapses content on trigger click", async () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      children: <div data-testid="content">Output content</div>,
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    // Initially collapsed - content should not be visible
    let content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toBeFalsy();

    // Click to expand
    const trigger = container.querySelector('[data-slot="basic-tool-trigger"]');
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Content should now be visible
    content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toContain("Output content");
  });

  it("supports keyboard toggling and updates aria-expanded", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      children: <div>Output content</div>,
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    const trigger = container.querySelector(
      '[data-slot="basic-tool-trigger"]'
    ) as HTMLButtonElement;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("respects defaultOpen prop", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      defaultOpen: true,
      children: <div data-testid="content">Output content</div>,
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    // Should start expanded
    const content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toContain("Output content");
  });

  it("respects forceOpen prop to keep content expanded", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      forceOpen: true,
      children: <div data-testid="content">Output content</div>,
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    // Should start expanded
    let content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toContain("Output content");

    // Try to collapse - should stay open
    const trigger = container.querySelector('[data-slot="basic-tool-trigger"]');
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toContain("Output content");
  });

  it("prevents collapse when locked is true", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      defaultOpen: true,
      locked: true,
      children: <div data-testid="content">Output content</div>,
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    // Should start expanded
    let content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toContain("Output content");

    // Try to collapse - should stay open due to locked
    const trigger = container.querySelector('[data-slot="basic-tool-trigger"]');
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toContain("Output content");
  });

  it("shows spinner for running status", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      status: "running",
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    const spinner = container.querySelector('[data-slot="basic-tool-status-icon"]');
    expect(spinner).not.toBeNull();
    expect(spinner?.className).toContain("animate-spin");
  });

  it("shows error styling for error status", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      status: "error",
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    const root = container.querySelector('[data-component="basic-tool"]');
    expect(root?.getAttribute("data-status")).toBe("error");
  });

  it("shows completed styling for completed status", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      status: "completed",
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    const root = container.querySelector('[data-component="basic-tool"]');
    expect(root?.getAttribute("data-status")).toBe("completed");
  });

  it("applies custom class", () => {
    const props: BasicToolProps = {
      trigger: { title: "Read File" },
      icon: "file",
      class: "custom-class",
    };

    ({ unmount: dispose } = render(() => <BasicTool {...props} />, { container }));

    const root = container.querySelector('[data-component="basic-tool"]');
    expect(root?.classList.contains("custom-class")).toBe(true);
  });
});
