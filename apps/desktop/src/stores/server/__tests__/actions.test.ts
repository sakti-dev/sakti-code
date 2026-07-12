import { describe, expect, it, vi } from "vite-plus/test";
import { SessionRegistry } from "../../session/session-registry.ts";
import { lastError, setLastError } from "../../workspace/ui-signals.ts";
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
function errRes(status = 500, data: unknown = null) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(data),
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
            ]),
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
            okRes([{ id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 }]),
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
            okRes([{ id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 }]),
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
                profileId: null,
                thinkingLevel: "off",
                createdAt: 1,
                updatedAt: 1,
              },
            ]),
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
    expect(session.store.turns).toHaveLength(1);
    expect(session.store.turns[0]!.userMessage?.role).toBe("user");
    expect(session.store.turns[0]!.userMessage?.content).toBe("hello world");
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

  describe("createSession", () => {
    it("posts worktreePath when provided", async () => {
      const deps = makeDeps();
      const mockApi = {
        api: {
          sessions: {
            $post: vi.fn(() =>
              okRes({
                id: "mission-1",
                projectId: "p1",
                title: "Mission",
                modelId: null,
                profileId: null,
                thinkingLevel: "off",
                kind: "mission",
                pendingTransitionBody: null,
                parentSessionId: null,
                changeName: "add-feature",
                worktreePath: "/tmp/sakti/projects/app--add-feature",
                pendingTransitionTo: null,
                status: "specify",
                createdAt: 1,
                updatedAt: 1,
              }),
            ),
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.createSession(
        "p1",
        "Mission",
        "add-feature",
        "/tmp/sakti/projects/app--add-feature",
      );

      expect(mockApi.api.sessions.$post).toHaveBeenCalledWith({
        json: {
          projectId: "p1",
          title: "Mission",
          changeName: "add-feature",
          worktreePath: "/tmp/sakti/projects/app--add-feature",
        },
      });
    });

    it("omits worktreePath when not provided", async () => {
      const deps = makeDeps();
      const mockApi = {
        api: {
          sessions: {
            $post: vi.fn(() =>
              okRes({
                id: "mission-1",
                projectId: "p1",
                title: null,
                modelId: null,
                profileId: null,
                thinkingLevel: "off",
                kind: "mission",
                pendingTransitionBody: null,
                parentSessionId: null,
                changeName: null,
                worktreePath: null,
                pendingTransitionTo: null,
                status: "specify",
                createdAt: 1,
                updatedAt: 1,
              }),
            ),
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.createSession("p1");

      expect(mockApi.api.sessions.$post).toHaveBeenCalledWith({ json: { projectId: "p1" } });
    });
  });

  describe("selectProfile", () => {
    it("PATCHes session profileId on server", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s1",
        projectId: "p1",
        title: null,
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "mission",
        pendingTransitionBody: null,
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: null,
        status: "build",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              $patch: vi.fn(() =>
                okRes({
                  id: "s1",
                  projectId: "p1",
                  title: null,
                  modelId: null,
                  profileId: "fast",
                  thinkingLevel: "off",
                  kind: "mission",
                  pendingTransitionBody: null,
                  parentSessionId: null,
                  changeName: null,
                  worktreePath: null,
                  pendingTransitionTo: null,
                  status: "build",
                  createdAt: 1,
                  updatedAt: 1,
                }),
              ),
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.selectProfile("s1", "fast");

      expect(mockApi.api.sessions[":id"].$patch).toHaveBeenCalledWith({
        param: { id: "s1" },
        json: { profileId: "fast" },
      });
      expect(deps.serverStore.store.sessions.s1?.profileId).toBe("fast");
    });

    it("does nothing when sessionId is null", async () => {
      const deps = makeDeps();
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              $patch: vi.fn(),
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.selectProfile(null, "fast");

      expect(mockApi.api.sessions[":id"].$patch).not.toHaveBeenCalled();
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

  it("loadMessages hydrates thinking + tool calls + tool results", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        sessions: {
          ":id": {
            messages: {
              $get: vi.fn(() =>
                okRes([
                  { role: "user", content: "test", timestamp: 1 },
                  {
                    role: "assistant",
                    content: [
                      { type: "thinking", thinking: "hmm" },
                      { type: "text", text: "ok" },
                      {
                        type: "toolCall",
                        id: "c1",
                        name: "bash",
                        arguments: { command: "ls" },
                      },
                    ],
                    timestamp: 2,
                  },
                  {
                    role: "toolResult",
                    toolCallId: "c1",
                    toolName: "bash",
                    content: [{ type: "text", text: "file1" }],
                    isError: false,
                    timestamp: 3,
                  },
                ]),
              ),
            },
          },
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadMessages("sess-1");

    const store = deps.sessionRegistry.get("sess-1").store;
    expect(store.turns).toHaveLength(1); // one turn with user + assistant

    const assistantMsg = store.turns[0]!.summary!;
    expect(assistantMsg.parts).toHaveLength(3); // thinking + text + tool_call(done)
    const toolPart = assistantMsg.parts[2]!;
    expect(toolPart.type).toBe("tool_call");
    expect((toolPart as { status: string }).status).toBe("done");
  });

  describe("confirmTransition", () => {
    it("POSTs the confirm action and mirrors the returned status", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s1",
        projectId: "p1",
        title: null,
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "mission",
        pendingTransitionBody: null,
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: null,
        status: "specify",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              confirm: {
                $post: vi.fn(() =>
                  okRes({
                    id: "s1",
                    projectId: "p1",
                    title: null,
                    modelId: null,
                    profileId: null,
                    thinkingLevel: "off",
                    kind: "mission",
                    pendingTransitionBody: null,
                    parentSessionId: null,
                    changeName: null,
                    worktreePath: null,
                    pendingTransitionTo: null,
                    status: "build",
                    createdAt: 1,
                    updatedAt: 2,
                  }),
                ),
              },
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      const result = await actions.confirmTransition("s1", "build", "the spec body", "approve");

      expect(result.ok).toBe(true);
      expect(mockApi.api.sessions[":id"].confirm.$post).toHaveBeenCalledWith({
        param: { id: "s1" },
        json: { action: "approve", to: "build", body: "the spec body" },
      });
      expect(deps.serverStore.store.sessions.s1?.status).toBe("build");
    });

    it("does nothing when the server responds not ok", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s1",
        projectId: "p1",
        title: null,
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "mission",
        pendingTransitionBody: null,
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: null,
        status: "specify",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              confirm: {
                $post: vi.fn(() => errRes()),
              },
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      const result = await actions.confirmTransition("s1", "build", "body", "approve");

      expect(result.ok).toBe(false);
      expect(deps.serverStore.store.sessions.s1?.status).toBe("specify");
    });

    it("surfaces the server confirm error detail", async () => {
      setLastError(null);
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s1",
        projectId: "p1",
        title: null,
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "plan",
        pendingTransitionBody: "brief",
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: "mission",
        status: "specify",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              confirm: {
                $post: vi.fn(() =>
                  errRes(500, {
                    error:
                      'unexpected change: "src/dirty.ts"; set preserveUnrelated: "stash" to proceed',
                  }),
                ),
              },
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      const result = await actions.confirmTransition("s1", "mission", "brief", "approve");

      expect(result.ok).toBe(false);
      expect(lastError()).toContain('unexpected change: "src/dirty.ts"');
      expect(lastError()).toContain('preserveUnrelated: "stash"');
    });

    it("mirrors changeName and worktreePath from the confirm response", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s1",
        projectId: "p1",
        title: null,
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "plan",
        pendingTransitionBody: "brief",
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: "mission",
        status: "specify",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              confirm: {
                $post: vi.fn(() =>
                  okRes({
                    id: "s1",
                    projectId: "p1",
                    title: null,
                    modelId: null,
                    profileId: null,
                    thinkingLevel: "off",
                    kind: "plan",
                    pendingTransitionBody: null,
                    parentSessionId: null,
                    changeName: "add-feature-x",
                    worktreePath: "/tmp/sakti/projects/app--add-feature",
                    pendingTransitionTo: null,
                    status: "specify",
                    createdAt: 1,
                    updatedAt: 2,
                  }),
                ),
              },
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      await actions.confirmTransition("s1", "mission", "brief", "approve");

      expect(deps.serverStore.store.sessions.s1?.changeName).toBe("add-feature-x");
      expect(deps.serverStore.store.sessions.s1?.worktreePath).toBe(
        "/tmp/sakti/projects/app--add-feature",
      );
    });
  });

  describe("renameSession", () => {
    it("PATCHes the title and mirrors it locally", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s1",
        projectId: "p1",
        title: "old",
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "mission",
        pendingTransitionBody: null,
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: null,
        status: "specify",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              $patch: vi.fn(() =>
                okRes({
                  id: "s1",
                  projectId: "p1",
                  title: "new title",
                  modelId: null,
                  profileId: null,
                  thinkingLevel: "off",
                  kind: "mission",
                  pendingTransitionBody: null,
                  parentSessionId: null,
                  changeName: null,
                  worktreePath: null,
                  pendingTransitionTo: null,
                  status: "specify",
                  createdAt: 1,
                  updatedAt: 2,
                }),
              ),
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      const ok = await actions.renameSession("s1", "new title");

      expect(ok).toBe(true);
      expect(mockApi.api.sessions[":id"].$patch).toHaveBeenCalledWith({
        param: { id: "s1" },
        json: { title: "new title" },
      });
      expect(deps.serverStore.store.sessions.s1?.title).toBe("new title");
    });
  });

  describe("deleteSession", () => {
    it("DELETEs and removes the session from the store", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s1",
        projectId: "p1",
        title: null,
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "mission",
        pendingTransitionBody: null,
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: null,
        status: "specify",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              $delete: vi.fn(() => okRes({ ok: true })),
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);

      const ok = await actions.deleteSession("s1");

      expect(ok).toBe(true);
      expect(mockApi.api.sessions[":id"].$delete).toHaveBeenCalledWith({ param: { id: "s1" } });
      expect(deps.serverStore.store.sessions.s1).toBeUndefined();
    });
  });

  describe("loadChat — pendingTransition re-derivation", () => {
    it("re-derives pendingTransition from server meta (gate survives reload)", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s-rehydrate",
        projectId: "p1",
        title: null,
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "mission",
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: "build",
        pendingTransitionBody: "spec summary",
        status: "specify",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              chat: {
                $get: vi.fn(() => okRes({ turns: [] })),
              },
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);
      const session = deps.sessionRegistry.get("s-rehydrate");

      await actions.loadChat("s-rehydrate");

      expect(session.store.pendingTransition).toMatchObject({
        to: "build",
        body: "spec summary",
      });
    });

    it("clears pendingTransition when server meta has none (auto edge consumed)", async () => {
      const deps = makeDeps();
      deps.serverStore.actions.addSession({
        id: "s-consumed",
        projectId: "p1",
        title: null,
        modelId: null,
        profileId: null,
        thinkingLevel: "off",
        kind: "mission",
        parentSessionId: null,
        changeName: null,
        worktreePath: null,
        pendingTransitionTo: null,
        pendingTransitionBody: null,
        status: "verify",
        createdAt: 1,
        updatedAt: 1,
      });
      const mockApi = {
        api: {
          sessions: {
            ":id": {
              chat: {
                $get: vi.fn(() => okRes({ turns: [] })),
              },
            },
          },
        },
      };
      const actions = createActions(mockApi as never, makeMockWs(), deps);
      const session = deps.sessionRegistry.get("s-consumed");
      session.actions.setPendingTransition({ to: "verify", body: "stale" });

      await actions.loadChat("s-consumed");

      expect(session.store.pendingTransition).toBeNull();
    });
  });
});
