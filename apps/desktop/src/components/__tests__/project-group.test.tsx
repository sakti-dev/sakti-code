import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { ProjectGroup } from "../layout/sidebar/project-group.tsx";

const mockSessions = [
  {
    id: "s1",
    title: "Session 1",
    projectId: "p1",
    modelId: "gpt-4",
    profileId: null,
    thinkingLevel: "off",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "s2",
    title: "Session 2",
    projectId: "p1",
    modelId: "gpt-4",
    profileId: null,
    thinkingLevel: "off",
    createdAt: 2,
    updatedAt: 2,
  },
];

describe("ProjectGroup", () => {
  it("renders project name", () => {
    render(() => (
      <ProjectGroup
        isActive={false}
        isExpanded={false}
        name="My Project"
        onSelectSession={vi.fn()}
        onToggle={vi.fn()}
        projectId="p1"
        sessions={mockSessions}
      />
    ));
    expect(screen.getByText("My Project")).toBeTruthy();
  });

  it("renders session count badge", () => {
    render(() => (
      <ProjectGroup
        isActive={false}
        isExpanded={false}
        name="My Project"
        onSelectSession={vi.fn()}
        onToggle={vi.fn()}
        projectId="p1"
        sessions={mockSessions}
      />
    ));
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows sessions when expanded", () => {
    render(() => (
      <ProjectGroup
        isActive={false}
        isExpanded={true}
        name="My Project"
        onSelectSession={vi.fn()}
        onToggle={vi.fn()}
        projectId="p1"
        sessions={mockSessions}
      />
    ));
    expect(screen.getByText("Session 1")).toBeTruthy();
    expect(screen.getByText("Session 2")).toBeTruthy();
  });

  it("hides sessions when collapsed", () => {
    render(() => (
      <ProjectGroup
        isActive={false}
        isExpanded={false}
        name="My Project"
        onSelectSession={vi.fn()}
        onToggle={vi.fn()}
        projectId="p1"
        sessions={mockSessions}
      />
    ));
    expect(screen.queryByText("Session 1")).toBeNull();
  });

  it("calls onToggle when header clicked", async () => {
    const onToggle = vi.fn();
    render(() => (
      <ProjectGroup
        isActive={false}
        isExpanded={false}
        name="My Project"
        onSelectSession={vi.fn()}
        onToggle={onToggle}
        projectId="p1"
        sessions={[]}
      />
    ));
    screen.getByText("My Project").click();
    expect(onToggle).toHaveBeenCalledWith("p1");
  });

  it("shows 'No sessions' when expanded with empty list", () => {
    render(() => (
      <ProjectGroup
        isActive={false}
        isExpanded={true}
        name="My Project"
        onSelectSession={vi.fn()}
        onToggle={vi.fn()}
        projectId="p1"
        sessions={[]}
      />
    ));
    expect(screen.getByText("No sessions")).toBeTruthy();
  });
});
