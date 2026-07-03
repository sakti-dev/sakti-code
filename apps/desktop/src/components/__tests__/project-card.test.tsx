import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import type { SessionMeta } from "~/stores/server/server-store";
import { ProjectCard } from "../home/project-card.tsx";

const mockProject = {
  id: "p1",
  name: "My Project",
  cwd: "/home/user/projects/my-project",
  createdAt: Date.now() - 86_400_000,
  updatedAt: Date.now() - 3_600_000,
};

const mockSessions: SessionMeta[] = [
  {
    id: "s1",
    title: "Session 1",
    projectId: "p1",
    modelId: "gpt-4",
    profileId: null,
    kind: "mission",
    status: "building",
    thinkingLevel: "off",
    createdAt: Date.now() - 7_200_000,
    updatedAt: Date.now() - 1_800_000,
  },
  {
    id: "s2",
    title: null,
    projectId: "p1",
    modelId: "gpt-4",
    profileId: null,
    kind: "mission",
    status: "building",
    thinkingLevel: "off",
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 600_000,
  },
];

describe("ProjectCard", () => {
  it("renders project name", () => {
    render(() => <ProjectCard onOpen={vi.fn()} project={mockProject} sessions={[]} />);
    expect(screen.getByText("My Project")).toBeTruthy();
  });

  it("renders project path", () => {
    render(() => <ProjectCard onOpen={vi.fn()} project={mockProject} sessions={[]} />);
    expect(screen.getByText("/home/user/projects/my-project")).toBeTruthy();
  });

  it("shows 'No sessions yet' when empty", () => {
    render(() => <ProjectCard onOpen={vi.fn()} project={mockProject} sessions={[]} />);
    expect(screen.getByText("No sessions yet")).toBeTruthy();
  });

  it("renders session titles", () => {
    render(() => <ProjectCard onOpen={vi.fn()} project={mockProject} sessions={mockSessions} />);
    expect(screen.getByText("Session 1")).toBeTruthy();
    expect(screen.getByText("Untitled session")).toBeTruthy();
  });

  it("calls onOpen when clicked", async () => {
    const onOpen = vi.fn();
    render(() => <ProjectCard onOpen={onOpen} project={mockProject} sessions={[]} />);
    screen.getByText("My Project").click();
    expect(onOpen).toHaveBeenCalled();
  });
});
