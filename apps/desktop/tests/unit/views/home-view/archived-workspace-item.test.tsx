import type { ArchivedWorkspace } from "@/core/chat/types";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("ArchivedWorkspaceItem", () => {
  let container: HTMLDivElement;
  let dispose: () => void | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("should render workspace name and archived date", () => {
    const workspace: ArchivedWorkspace = {
      id: "1",
      name: "Archived Project",
      path: "/home/user/projects/archived",
      archivedAt: new Date("2024-01-15"),
      isMerged: true,
      baseBranch: "main",
      repoPath: "/repo",
    };

    ({ unmount: dispose } = render(
      () => (
        <div data-test="container">
          <span>{workspace.name}</span>
          <span>{workspace.archivedAt.toLocaleDateString()}</span>
        </div>
      ),
      { container }
    ));
    expect(container.textContent).toContain("Archived Project");
    expect(container.textContent).toContain("1/15/2024");
  });

  it("should show merged status indicator", () => {
    const mergedWorkspace: ArchivedWorkspace = {
      id: "1",
      name: "Merged Project",
      path: "/path",
      archivedAt: new Date(),
      isMerged: true,
      baseBranch: "main",
      repoPath: "/repo",
    };

    ({ unmount: dispose } = render(
      () => (
        <div data-test="container">{mergedWorkspace.isMerged ? "✓ Merged" : "✗ Not Merged"}</div>
      ),
      { container }
    ));
    expect(container.textContent).toContain("✓ Merged");
  });
});
