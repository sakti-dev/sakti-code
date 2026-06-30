import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { ProjectContextMenu } from "../layout/sidebar/project-context-menu.tsx";

describe("ProjectContextMenu", () => {
  it("renders menu items", () => {
    render(() => (
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
    expect(screen.getAllByText("Open in Terminal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open in Editor").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Copy Path").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Remove Project").length).toBeGreaterThan(0);
  });

  it("calls onOpenInTerminal when clicked", async () => {
    const onOpenInTerminal = vi.fn();
    render(() => (
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
    screen.getAllByText("Open in Terminal")[0]!.click();
    expect(onOpenInTerminal).toHaveBeenCalledWith("p1");
  });

  it("calls onClose after action", async () => {
    const onClose = vi.fn();
    render(() => (
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
    screen.getAllByText("Copy Path")[0]!.click();
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
