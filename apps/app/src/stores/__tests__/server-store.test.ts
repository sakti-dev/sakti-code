import { describe, expect, it } from "vitest";
import { createServerStore } from "../server-store.ts";

describe("server store — setProjects", () => {
  it("populates projects and order", () => {
    const { store, actions } = createServerStore();
    actions.setProjects([
      { id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 },
      { id: "p2", name: "B", cwd: "/b", createdAt: 2, updatedAt: 2 },
    ]);

    expect(Object.keys(store.projects)).toHaveLength(2);
    expect(store.projects.p1!.name).toBe("A");
    expect(store.projectOrder).toEqual(["p1", "p2"]);
  });

  it("replaces previous projects on second call", () => {
    const { store, actions } = createServerStore();
    actions.setProjects([
      { id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 },
    ]);
    actions.setProjects([
      { id: "p2", name: "B", cwd: "/b", createdAt: 2, updatedAt: 2 },
    ]);

    expect(store.projects.p1).toBeUndefined();
    expect(store.projects.p2).toBeDefined();
    expect(store.projectOrder).toEqual(["p2"]);
  });
});

describe("server store — setActiveProject", () => {
  it("updates activeProjectId", () => {
    const { store, actions } = createServerStore();
    actions.setActiveProject("p1");
    expect(store.activeProjectId).toBe("p1");
  });
});

describe("server store — setSessions", () => {
  it("populates sessions", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "Sess",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(store.sessions.s1).toBeDefined();
    expect(store.sessions.s1!.title).toBe("Sess");
  });

  it("replaces previous sessions on second call", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "Old",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    actions.setSessions([
      {
        id: "s2",
        projectId: "p1",
        title: "New",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    expect(store.sessions.s1).toBeUndefined();
    expect(store.sessions.s2).toBeDefined();
  });
});

describe("server store — addSession", () => {
  it("adds a single session", () => {
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

  it("appends to sessionOrder", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "A",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    actions.addSession({
      id: "s2",
      projectId: "p1",
      title: "B",
      modelId: "gpt-4",
      thinkingLevel: "off",
      createdAt: 2,
      updatedAt: 2,
    });

    expect(store.sessionOrder).toEqual(["s1", "s2"]);
  });
});

describe("server store — updateSession", () => {
  it("merges partial patch into session", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "Old",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    actions.updateSession("s1", { title: "New" });

    expect(store.sessions.s1!.title).toBe("New");
    expect(store.sessions.s1!.modelId).toBe("gpt-4");
  });
});

describe("server store — removeSession", () => {
  it("removes from sessions and sessionOrder", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "A",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "s2",
        projectId: "p1",
        title: "B",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    actions.removeSession("s1");

    expect(store.sessions.s1).toBeUndefined();
    expect(store.sessionOrder).toEqual(["s2"]);
  });

  it("removing non-existent session does not throw", () => {
    const { actions } = createServerStore();
    expect(() => actions.removeSession("nonexistent")).not.toThrow();
  });
});

describe("server store — setActiveSession", () => {
  it("updates activeSessionId", () => {
    const { store, actions } = createServerStore();
    actions.setActiveSession("s1");
    expect(store.activeSessionId).toBe("s1");
  });
});

describe("server store — setConnectionStatus", () => {
  it("updates connection status", () => {
    const { store, actions } = createServerStore();
    actions.setConnectionStatus("open");
    expect(store.connection.status).toBe("open");

    actions.setConnectionStatus("closed");
    expect(store.connection.status).toBe("closed");
  });
});

describe("server store — removeProject", () => {
  it("removes project from projects and projectOrder", () => {
    const { store, actions } = createServerStore();
    actions.setProjects([
      { id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 },
      { id: "p2", name: "B", cwd: "/b", createdAt: 2, updatedAt: 2 },
    ]);

    actions.removeProject("p1");

    expect(store.projects.p1).toBeUndefined();
    expect(store.projects.p2).toBeDefined();
    expect(store.projectOrder).toEqual(["p2"]);
  });

  it("removing non-existent project does not throw", () => {
    const { actions } = createServerStore();
    expect(() => actions.removeProject("nonexistent")).not.toThrow();
  });
});
