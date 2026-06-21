import { describe, expect, it, vi } from "vitest";
import { createActions } from "../actions.ts";
import { getServerStore } from "../server-store.ts";
import { disposeSessionStore, getSessionStore } from "../session-registry.ts";
import type { WsClient } from "../ws-client.ts";

function makeMockWs(): WsClient {
  return {
    send: vi.fn(() => {}),
    disconnect: vi.fn(() => {}),
  };
}

describe("actions", () => {
  it("loadProjects fetches and populates store", async () => {
    const server = getServerStore();
    const mockApi = {
      api: {
        projects: {
          get: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: "p1",
                  name: "Proj",
                  cwd: "/tmp",
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
              error: null,
            })
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs());

    await actions.loadProjects();

    expect(server.store.projects.p1).toBeDefined();
    expect(server.store.projectOrder).toEqual(["p1"]);
  });

  it("loadSessions fetches sessions for a project", async () => {
    const server = getServerStore();
    const mockApi = {
      api: {
        sessions: {
          get: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: "s1",
                  projectId: "p1",
                  title: "Sess",
                  modelId: "gpt-4",
                  thinkingLevel: "off",
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
              error: null,
            })
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs());

    await actions.loadSessions("p1");

    expect(server.store.sessions.s1).toBeDefined();
  });

  it("sendPrompt inserts user message optimistically and sends via WS", async () => {
    const ws = makeMockWs();
    const mockApi = {} as never;
    const actions = createActions(mockApi, ws);

    actions.sendPrompt("s1", "hello world");

    const session = getSessionStore("s1");
    expect(session.store.messageOrder).toHaveLength(1);
    const msg = session.store.messages[session.store.messageOrder[0]!]!;
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("hello world");

    expect(ws.send).toHaveBeenCalledWith({
      type: "prompt",
      sessionId: "s1",
      message: "hello world",
    });

    disposeSessionStore("s1");
  });

  it("abortRun sends abort via WS", async () => {
    const ws = makeMockWs();
    const actions = createActions({} as never, ws);

    actions.abortRun("s1");

    expect(ws.send).toHaveBeenCalledWith({
      type: "abort",
      sessionId: "s1",
    });
  });
});
