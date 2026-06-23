import { describe, expect, it, vi } from "vitest";
import { SessionRegistry } from "../../session/session-registry.ts";
import { createActions } from "../actions.ts";
import { createServerStore } from "../server-store.ts";
import type { WsClient } from "../ws-client.ts";

function makeMockWs(): WsClient {
  return {
    send: vi.fn(() => {}),
    disconnect: vi.fn(() => {}),
  };
}

function makeDeps() {
  return {
    serverStore: createServerStore(),
    sessionRegistry: new SessionRegistry(),
  };
}

/** Minimal Hono client fetch-Response shape (success). */
function okRes(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

/** Minimal Hono client fetch-Response shape (error). */
function errRes() {
  return Promise.resolve({
    ok: false,
    json: () => Promise.resolve(null),
  });
}

describe("actions", () => {
  it("loadProjects fetches and populates store", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        projects: {
          $get: vi.fn(() =>
            okRes([
              {
                id: "p1",
                name: "Proj",
                cwd: "/tmp",
                createdAt: 1,
                updatedAt: 1,
              },
            ])
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadProjects();

    expect(deps.serverStore.store.projects.p1).toBeDefined();
    expect(deps.serverStore.store.projectOrder).toEqual(["p1"]);
  });

  it("loadProjects sets active project to first if none set", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        projects: {
          $get: vi.fn(() =>
            okRes([
              { id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 },
            ])
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    expect(deps.serverStore.store.activeProjectId).toBeNull();
    await actions.loadProjects();
    expect(deps.serverStore.store.activeProjectId).toBe("p1");
  });

  it("loadProjects does not override activeProjectId if already set", async () => {
    const deps = makeDeps();
    deps.serverStore.actions.setActiveProject("p2");
    const mockApi = {
      api: {
        projects: {
          $get: vi.fn(() =>
            okRes([
              { id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 },
            ])
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadProjects();
    expect(deps.serverStore.store.activeProjectId).toBe("p2");
  });

  it("loadSessions fetches sessions for a project", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        sessions: {
          $get: vi.fn(() =>
            okRes([
              {
                id: "s1",
                projectId: "p1",
                title: "Sess",
                modelId: "gpt-4",
                thinkingLevel: "off",
                createdAt: 1,
                updatedAt: 1,
              },
            ])
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadSessions("p1");

    expect(deps.serverStore.store.sessions.s1).toBeDefined();
  });

  it("sendPrompt inserts user message optimistically and sends via WS", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.sendPrompt("s1", "hello world");

    const session = deps.sessionRegistry.get("s1");
    expect(session.store.messageOrder).toHaveLength(1);
    const msg = session.store.messages[session.store.messageOrder[0]!]!;
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("hello world");
    expect(session.store.streaming.phase).toBe("thinking");

    expect(ws.send).toHaveBeenCalledWith({
      type: "prompt",
      sessionId: "s1",
      message: "hello world",
    });
  });

  it("abortRun sends abort via WS", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.abortRun("s1");

    expect(ws.send).toHaveBeenCalledWith({
      type: "abort",
      sessionId: "s1",
    });
  });

  it("steerRun sends steer via WS", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.steerRun("s1", "stop and do X");

    expect(ws.send).toHaveBeenCalledWith({
      type: "steer",
      sessionId: "s1",
      message: "stop and do X",
    });
  });

  it("followUpRun sends followUp via WS", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.followUpRun("s1", "now do Y");

    expect(ws.send).toHaveBeenCalledWith({
      type: "followUp",
      sessionId: "s1",
      message: "now do Y",
    });
  });

  describe("selectModel", () => {
    it("writes provider+model to default profile in profiles.json", async () => {
      const deps = makeDeps();
      const existingProfiles = {
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: { default: { provider: "", model: "" } },
          },
        },
      };
      let writtenBody: unknown;
      const mockApi = {
        api: {
          profiles: {
            $get: vi.fn(() => okRes(existingProfiles)),
            $put: vi.fn((args: { json: unknown }) => {
              writtenBody = args.json;
              return okRes(null);
            }),
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.selectModel(null, "anthropic", "claude-sonnet-4-20250514");

      expect(mockApi.api.profiles.$get).toHaveBeenCalledOnce();
      expect(mockApi.api.profiles.$put).toHaveBeenCalledOnce();
      expect(writtenBody).toEqual({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: {
                provider: "anthropic",
                model: "claude-sonnet-4-20250514",
              },
            },
          },
        },
      });
    });

    it("preserves existing thinkingLevel when updating model", async () => {
      const deps = makeDeps();
      const existingProfiles = {
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: {
                provider: "openai",
                model: "gpt-4",
                thinkingLevel: "high",
              },
            },
          },
        },
      };
      let writtenBody: unknown;
      const mockApi = {
        api: {
          profiles: {
            $get: vi.fn(() => okRes(existingProfiles)),
            $put: vi.fn((args: { json: unknown }) => {
              writtenBody = args.json;
              return okRes(null);
            }),
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.selectModel(null, "anthropic", "claude-sonnet-4-20250514");

      const written = writtenBody as {
        profiles: {
          default: { models: { default: { thinkingLevel?: string } } };
        };
      };
      expect(written.profiles.default.models.default.thinkingLevel).toBe(
        "high"
      );
    });

    it("updates session.modelId for display when sessionId provided", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s1",
        projectId: "p1",
        title: null,
        modelId: "",
        thinkingLevel: "off",
        kind: "task",
        createdAt: 1,
        updatedAt: 1,
      });
      const existingProfiles = {
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: { default: { provider: "", model: "" } },
          },
        },
      };
      const mockApi = {
        api: {
          profiles: {
            $get: vi.fn(() => okRes(existingProfiles)),
            $put: vi.fn(() => okRes(null)),
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.selectModel("s1", "anthropic", "claude-sonnet-4-20250514");

      expect(deps.serverStore.store.sessions.s1?.modelId).toBe(
        "claude-sonnet-4-20250514"
      );
    });

    it("preserves other profiles and modes when writing", async () => {
      const deps = makeDeps();
      const existingProfiles = {
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: { provider: "openai", model: "gpt-4" },
              intake: { provider: "openai", model: "gpt-4o-mini" },
            },
          },
          custom: {
            name: "Custom",
            models: {
              default: { provider: "anthropic", model: "claude-3-haiku" },
            },
          },
        },
      };
      let writtenBody: unknown;
      const mockApi = {
        api: {
          profiles: {
            $get: vi.fn(() => okRes(existingProfiles)),
            $put: vi.fn((args: { json: unknown }) => {
              writtenBody = args.json;
              return okRes(null);
            }),
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.selectModel(null, "google", "gemini-2.5-pro");

      const written = writtenBody as {
        profiles: Record<
          string,
          { models: Record<string, { provider: string; model: string }> }
        >;
      };
      // Other profile untouched
      expect(written.profiles.custom!.models.default!.model).toBe(
        "claude-3-haiku"
      );
      // Other mode (intake) untouched
      expect(written.profiles.default!.models.intake?.model).toBe(
        "gpt-4o-mini"
      );
      // Default mode updated
      expect(written.profiles.default!.models.default!.model).toBe(
        "gemini-2.5-pro"
      );
    });
  });

  it("REST error does not crash and leaves store unchanged", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        projects: {
          $get: vi.fn(() => errRes()),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadProjects();

    expect(Object.keys(deps.serverStore.store.projects)).toHaveLength(0);
  });
});
