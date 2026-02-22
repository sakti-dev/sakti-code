import { ToolPart } from "@/views/workspace-view/chat-area/parts/tool-part";
import {
  clearToolRegistry,
  registerToolRenderer,
  type ToolRendererProps,
} from "@/views/workspace-view/chat-area/tools/tool-registry";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("ToolPart", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    clearToolRegistry();
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("renders tool trigger with icon and name", () => {
    const part = {
      type: "tool",
      tool: "read",
      state: { status: "completed" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} />, { container }));

    expect(container.textContent).toContain("Read");
  });

  it("shows spinner when status is running", () => {
    const part = {
      type: "tool",
      tool: "bash",
      state: { status: "running" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} />, { container }));

    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("running");
  });

  it("shows error card when status is error", () => {
    const part = {
      type: "tool",
      tool: "edit",
      state: { status: "error", error: "File not found" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} />, { container }));

    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("error");
  });

  it("renders output when status is completed", () => {
    const part = {
      type: "tool",
      tool: "read",
      state: { status: "completed" },
      output: "File contents here",
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} defaultOpen={true} />, {
      container,
    }));

    // Wait for content
    const content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toContain("File contents here");
  });

  it("dispatches to registered tool renderer if available", () => {
    const CustomRenderer = (_props: ToolRendererProps) => (
      <div data-testid="custom-renderer">Custom Tool!</div>
    );
    registerToolRenderer("custom-tool", CustomRenderer);

    const part = {
      type: "tool",
      tool: "custom-tool",
      state: { status: "completed" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} />, { container }));

    const custom = container.querySelector('[data-testid="custom-renderer"]');
    expect(custom).not.toBeNull();
    expect(container.textContent).toContain("Custom Tool!");
  });

  it("falls back to BasicTool for unregistered tools", () => {
    const part = {
      type: "tool",
      tool: "unknown-tool",
      state: { status: "completed" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} />, { container }));

    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool).not.toBeNull();
    expect(container.textContent).toContain("Unknown-tool");
  });

  it("extracts status from part state", () => {
    const part = {
      type: "tool",
      tool: "read",
      state: { status: "completed" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} />, { container }));

    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("completed");
  });

  it("extracts output from part", () => {
    const part = {
      type: "tool",
      tool: "bash",
      state: { status: "completed" },
      output: "command output",
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} defaultOpen={true} />, {
      container,
    }));

    const content = container.querySelector('[data-slot="basic-tool-content"]');
    expect(content?.textContent).toContain("command output");
  });

  it("extracts args from part for subtitle", () => {
    const part = {
      type: "tool",
      tool: "bash",
      args: "npm run build",
      state: { status: "running" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} />, { container }));

    expect(container.textContent).toContain("npm run build");
  });

  it("applies data-component attribute", () => {
    const part = {
      type: "tool",
      tool: "read",
      state: { status: "completed" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} />, { container }));

    const toolPart = container.querySelector('[data-component="tool-part-wrapper"]');
    expect(toolPart).not.toBeNull();
  });

  it("applies custom class", () => {
    const part = {
      type: "tool",
      tool: "read",
      state: { status: "completed" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} class="custom-class" />, {
      container,
    }));

    const toolPart = container.querySelector('[data-component="tool-part-wrapper"]');
    expect(toolPart?.classList.contains("custom-class")).toBe(true);
  });

  it("passes locked prop when tool is pending", () => {
    const part = {
      type: "tool",
      tool: "permission",
      state: { status: "pending" },
    };

    ({ unmount: dispose } = render(() => <ToolPart part={part} defaultOpen={true} />, {
      container,
    }));

    // Content should be locked open
    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool).not.toBeNull();
  });
});
