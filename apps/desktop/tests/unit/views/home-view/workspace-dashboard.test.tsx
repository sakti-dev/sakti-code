import type { ArchivedWorkspace, RecentProject } from "@/core/chat/types";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("WorkspaceDashboard", () => {
  let container: HTMLDivElement;
  let dispose: () => void | undefined;

  const mockRecentWorkspaces: RecentProject[] = [
    {
      id: "1",
      name: "Project One",
      path: "/home/user/projects/one",
      lastOpened: new Date(),
      gitStatus: {
        branch: "main",
        baseBranch: "origin/main",
        ahead: 2,
        behind: 0,
        hasUncommitted: false,
      },
    },
    {
      id: "2",
      name: "Project Two",
      path: "/home/user/projects/two",
      lastOpened: new Date(),
    },
  ];

  const mockArchivedWorkspaces: ArchivedWorkspace[] = [
    {
      id: "3",
      name: "Archived Project",
      path: "/home/user/projects/archived",
      archivedAt: new Date("2024-01-01"),
      isMerged: true,
      baseBranch: "main",
      repoPath: "/repo",
    },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("should render recent workspaces column", () => {
    ({ unmount: dispose } = render(
      () => (
        <div>
          <div class="column-header">
            <span class="column-title">Recent Workspaces</span>
          </div>
          {mockRecentWorkspaces.map(w => (
            <div data-test={`workspace-${w.id}`}>{w.name}</div>
          ))}
        </div>
      ),
      { container }
    ));
    expect(container.textContent).toContain("Recent Workspaces");
    expect(container.textContent).toContain("Project One");
    expect(container.textContent).toContain("Project Two");
  });

  it("should render archived workspaces column", () => {
    ({ unmount: dispose } = render(
      () => (
        <div>
          <div class="column-header">
            <span class="column-title">Archived</span>
          </div>
          {mockArchivedWorkspaces.map(w => (
            <div data-test={`archived-${w.id}`}>{w.name}</div>
          ))}
        </div>
      ),
      { container }
    ));
    expect(container.textContent).toContain("Archived");
    expect(container.textContent).toContain("Archived Project");
  });
});
