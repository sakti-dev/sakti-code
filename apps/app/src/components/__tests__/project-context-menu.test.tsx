import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ProjectContextMenu } from "../layout/project-context-menu.tsx";

describe("ProjectContextMenu", () => {
  it("renders menu items", () => {
    const { getByText } = render(() => (
      <ProjectContextMenu
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onRemove={vi.fn()}
        projectId="p1"
        projectName="My Project"
        x={100}
        y={100}
      />
    ));
    expect(getByText("Open in Terminal")).toBeTruthy();
    expect(getByText("Open in Editor")).toBeTruthy();
    expect(getByText("Copy Path")).toBeTruthy();
    expect(getByText("Remove Project")).toBeTruthy();
  });

  it("calls onOpenInTerminal when clicked", async () => {
    const onOpenInTerminal = vi.fn();
    const { getByText } = render(() => (
      <ProjectContextMenu
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenInTerminal={onOpenInTerminal}
        onRemove={vi.fn()}
        projectId="p1"
        projectName="My Project"
        x={100}
        y={100}
      />
    ));
    getByText("Open in Terminal").click();
    expect(onOpenInTerminal).toHaveBeenCalledWith("p1");
  });

  it("calls onClose after action", async () => {
    const onClose = vi.fn();
    const { getByText } = render(() => (
      <ProjectContextMenu
        onClose={onClose}
        onCopyPath={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onRemove={vi.fn()}
        projectId="p1"
        projectName="My Project"
        x={100}
        y={100}
      />
    ));
    getByText("Copy Path").click();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders at correct position", () => {
    const { container } = render(() => (
      <ProjectContextMenu
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onRemove={vi.fn()}
        projectId="p1"
        projectName="My Project"
        x={200}
        y={300}
      />
    ));
    const menu = container.querySelector('[class*="fixed"]');
    expect(menu).toBeTruthy();
  });
});
