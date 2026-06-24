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
                profileId: null,
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
        kind: "task",
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
                  kind: "task",
                  createdAt: 1,
                  updatedAt: 1,
                })
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
                ])
              ),
            },
          },
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadMessages("sess-1");

    const store = deps.sessionRegistry.get("sess-1").store;
    expect(store.messageOrder).toHaveLength(2); // user + assistant (toolResult merged)

    const assistantMsg = store.messages[store.messageOrder[1]!]!;
    expect(assistantMsg.parts).toHaveLength(3); // thinking + text + tool_call(done)
    const toolPart = assistantMsg.parts[2]!;
    expect(toolPart.type).toBe("tool_call");
    expect((toolPart as { status: string }).status).toBe("done");
  });
});

describe("replay actions", () => {
  it("replayStart resets session, sets replayState, sends WS replay start", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const session = deps.sessionRegistry.get("sess-1");
    session.actions.addMessage({
      id: "m1",
      role: "user",
      content: "old",
      parts: [{ type: "text", text: "old" }],
      isStreaming: false,
      timestamp: 0,
    });

    const actions = createActions({} as never, ws, deps);
    actions.replayStart("sess-1");

    expect(ws.send).toHaveBeenCalledWith({
      type: "replay",
      sessionId: "sess-1",
      action: "start",
    });
    expect(session.store.messageOrder).toHaveLength(0);
  });

  it("replayPause sends WS replay pause", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.replayPause("sess-1");

    expect(ws.send).toHaveBeenCalledWith({
      type: "replay",
      sessionId: "sess-1",
      action: "pause",
    });
  });

  it("replayResume sends WS replay resume", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.replayResume("sess-1");

    expect(ws.send).toHaveBeenCalledWith({
      type: "replay",
      sessionId: "sess-1",
      action: "resume",
    });
  });

  it("replayReset sends abort WS and clears session store", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const session = deps.sessionRegistry.get("sess-1");
    session.actions.addMessage({
      id: "m1",
      role: "user",
      content: "old",
      parts: [{ type: "text", text: "old" }],
      isStreaming: false,
      timestamp: 0,
    });

    const actions = createActions({} as never, ws, deps);
    actions.replayReset("sess-1");

    expect(ws.send).toHaveBeenCalledWith({
      type: "abort",
      sessionId: "sess-1",
    });
    expect(session.store.messageOrder).toHaveLength(0);
  });
});
