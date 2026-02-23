import type { RecentProject } from "@/core/chat/types";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("WorkspaceCard", () => {
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

  it("should render workspace name and path", () => {
    const workspace: RecentProject = {
      id: "1",
      name: "Test Project",
      path: "/home/user/projects/test",
      lastOpened: new Date(),
    };

    ({ unmount: dispose } = render(
      () => (
        <div data-test="container">
          {workspace.name} - {workspace.path}
        </div>
      ),
      { container }
    ));
    expect(container.textContent).toContain("Test Project");
    expect(container.textContent).toContain("/home/user/projects/test");
  });

  it("should display git status when provided", () => {
    const workspace: RecentProject = {
      id: "1",
      name: "Test Project",
      path: "/home/user/projects/test",
      lastOpened: new Date(),
      gitStatus: {
        branch: "feature-branch",
        baseBranch: "main",
        ahead: 2,
        behind: 0,
        hasUncommitted: false,
      },
    };

    ({ unmount: dispose } = render(
      () => <div data-test="git-status">{workspace.gitStatus?.branch}</div>,
      { container }
    ));
    expect(container.textContent).toContain("feature-branch");
  });
});
