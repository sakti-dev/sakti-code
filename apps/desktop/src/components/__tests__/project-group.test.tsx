import { render } from "@solidjs/testing-library";
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
    const { getByText } = render(() => (
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
    expect(getByText("My Project")).toBeTruthy();
  });

  it("renders session count badge", () => {
    const { getByText } = render(() => (
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
    expect(getByText("2")).toBeTruthy();
  });

  it("shows sessions when expanded", () => {
    const { getByText } = render(() => (
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
    expect(getByText("Session 1")).toBeTruthy();
    expect(getByText("Session 2")).toBeTruthy();
  });

  it("hides sessions when collapsed", () => {
    const { queryByText } = render(() => (
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
    expect(queryByText("Session 1")).toBeNull();
  });

  it("calls onToggle when header clicked", async () => {
    const onToggle = vi.fn();
    const { getByText } = render(() => (
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
    getByText("My Project").click();
    expect(onToggle).toHaveBeenCalledWith("p1");
  });

  it("shows 'No sessions' when expanded with empty list", () => {
    const { getByText } = render(() => (
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
    expect(getByText("No sessions")).toBeTruthy();
  });
});
