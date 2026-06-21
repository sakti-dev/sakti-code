import { describe, expect, it } from "vitest";
import { createServerStore } from "../server-store.ts";

describe("server store", () => {
  it("setProjects populates projects and order", () => {
    const { store, actions } = createServerStore();

    actions.setProjects([
      {
        id: "p1",
        name: "Project 1",
        cwd: "/tmp/p1",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "p2",
        name: "Project 2",
        cwd: "/tmp/p2",
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    expect(Object.keys(store.projects)).toHaveLength(2);
    expect(store.projects.p1!.name).toBe("Project 1");
    expect(store.projectOrder).toEqual(["p1", "p2"]);
  });

  it("setActiveProject updates activeProjectId", () => {
    const { store, actions } = createServerStore();
    actions.setActiveProject("p1");
    expect(store.activeProjectId).toBe("p1");
  });

  it("setSessions populates sessions for a project", () => {
    const { store, actions } = createServerStore();

    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "Session 1",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(store.sessions.s1).toBeDefined();
    expect(store.sessions.s1!.title).toBe("Session 1");
  });

  it("setConnectionStatus updates connection", () => {
    const { store, actions } = createServerStore();
    actions.setConnectionStatus("open");
    expect(store.connection.status).toBe("open");
  });

  it("addSession adds a single session", () => {
    const { store, actions } = createServerStore();
    actions.addSession({
      id: "s1",
      projectId: "p1",
      title: null,
      modelId: "gpt-4",
      thinkingLevel: "off",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(store.sessions.s1).toBeDefined();
  });

  it("setActiveSession updates activeSessionId", () => {
    const { store, actions } = createServerStore();
    actions.setActiveSession("s1");
    expect(store.activeSessionId).toBe("s1");
  });
});
