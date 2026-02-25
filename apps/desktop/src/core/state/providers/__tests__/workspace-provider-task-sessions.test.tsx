import {
  WorkspaceProvider,
  useWorkspace,
  type WorkspaceContextValue,
} from "@/core/state/providers/workspace-provider";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@solidjs/router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: "ws-1" }),
}));

function mockJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  } as unknown as Response;
}

describe("WorkspaceProvider task-session state", () => {
  let ctx: WorkspaceContextValue | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
    localStorage.clear();

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/workspaces/ws-1")) {
        return Promise.resolve(
          mockJsonResponse({
            workspace: {
              id: "ws-1",
              path: "/repo",
              name: "Repo",
              status: "active",
              baseBranch: null,
              repoPath: null,
              isMerged: false,
              archivedAt: null,
              createdAt: new Date().toISOString(),
              lastOpenedAt: new Date().toISOString(),
            },
          })
        );
      }

      if (url.includes("/api/task-sessions")) {
        return Promise.resolve(mockJsonResponse({ taskSessions: [] }));
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    }));

    (window as Window & typeof globalThis & { saktiCodeAPI: unknown }).saktiCodeAPI = {
      server: {
        getConfig: vi.fn(async () => ({
          baseUrl: "http://127.0.0.1:3000",
          token: "test-token",
        })),
      },
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function mount() {
    return render(() => (
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>
    ));
  }

  function Probe() {
    ctx = useWorkspace();
    return null;
  }

  it("initializes with empty taskSessions", async () => {
    mount();

    await vi.waitFor(() => {
      expect(ctx).toBeDefined();
      expect(ctx?.isClientReady()).toBe(true);
    });

    expect(ctx?.taskSessions()).toEqual([]);
  });

  it("refreshTaskSessions uses task-session API", async () => {
    mount();

    await vi.waitFor(() => {
      expect(ctx?.isClientReady()).toBe(true);
    });

    await ctx?.refreshTaskSessions();

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(args =>
      String(args[0])
    );

    expect(calls.some(url => url.includes("/api/task-sessions?workspaceId=ws-1&kind=task"))).toBe(
      true
    );
    expect(calls.some(url => url.includes("/api/sessions"))).toBe(false);
  });

  it("does not auto-select first task session", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/workspaces/ws-1")) {
        return Promise.resolve(
          mockJsonResponse({
            workspace: {
              id: "ws-1",
              path: "/repo",
              name: "Repo",
              status: "active",
              baseBranch: null,
              repoPath: null,
              isMerged: false,
              archivedAt: null,
              createdAt: new Date().toISOString(),
              lastOpenedAt: new Date().toISOString(),
            },
          })
        );
      }

      if (url.includes("/api/task-sessions")) {
        return Promise.resolve(
          mockJsonResponse({
            taskSessions: [
              {
                taskSessionId: "ts-1",
                resourceId: "res-1",
                threadId: "thread-1",
                workspaceId: "ws-1",
                title: "Task Session 1",
                status: "researching",
                specType: null,
                sessionKind: "task",
                createdAt: new Date().toISOString(),
                lastAccessed: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
              },
            ],
          })
        );
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    }));

    mount();

    await vi.waitFor(() => {
      expect(ctx?.isClientReady()).toBe(true);
      expect(ctx?.taskSessions().length).toBe(1);
    });

    expect(ctx?.activeTaskSessionId()).toBeNull();
  });

  it("applies task-session.updated SSE payload without full refetch", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces/ws-1")) {
        return Promise.resolve(
          mockJsonResponse({
            workspace: {
              id: "ws-1",
              path: "/repo",
              name: "Repo",
              status: "active",
              baseBranch: null,
              repoPath: null,
              isMerged: false,
              archivedAt: null,
              createdAt: new Date().toISOString(),
              lastOpenedAt: new Date().toISOString(),
            },
          })
        );
      }

      if (url.includes("/api/task-sessions")) {
        return Promise.resolve(
          mockJsonResponse({
            taskSessions: [
              {
                taskSessionId: "ts-1",
                resourceId: "res-1",
                threadId: "thread-1",
                workspaceId: "ws-1",
                title: "Original title",
                status: "researching",
                specType: null,
                sessionKind: "task",
                createdAt: new Date().toISOString(),
                lastAccessed: new Date().toISOString(),
                lastActivityAt: "2025-02-25T00:00:00.000Z",
              },
            ],
          })
        );
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    }));

    mount();

    await vi.waitFor(() => {
      expect(ctx?.taskSessions().length).toBe(1);
    });

    window.dispatchEvent(
      new CustomEvent("sakti-code:task-session.updated", {
        detail: {
          taskSessionId: "ts-1",
          workspaceId: "ws-1",
          status: "specifying",
          specType: "quick",
          sessionKind: "task",
          title: "Updated title",
          lastActivityAt: "2025-02-25T10:00:00.000Z",
          mutation: "updated",
        },
      })
    );

    await vi.waitFor(() => {
      const updated = ctx?.taskSessions()[0];
      expect(updated?.title).toBe("Updated title");
      expect(updated?.taskStatus).toBe("specifying");
      expect(updated?.specType).toBe("quick");
    });
  });
});
