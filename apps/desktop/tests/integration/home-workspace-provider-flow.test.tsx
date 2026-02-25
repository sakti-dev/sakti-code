import { ChatProvider, useChatContext } from "@/core/state/contexts/chat-provider";
import { AppProvider } from "@/core/state/providers/app-provider";
import { useWorkspace, WorkspaceProvider } from "@/core/state/providers/workspace-provider";
import HomeView from "@/views/home-view/home-view";
import { cleanup, render } from "@solidjs/testing-library";
import { createMemo, Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const { mockedNavigate, mockedParams } = vi.hoisted(() => {
  return {
    mockedNavigate: vi.fn(),
    mockedParams: { id: "project-123" },
  };
});

vi.mock("@solidjs/router", () => {
  return {
    useNavigate: () => mockedNavigate,
    useParams: () => mockedParams,
  };
});

vi.mock("@/core/services/sse/sse-manager", () => {
  return {
    createSSEManager: () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: () => true,
      getStatus: () => "connected" as const,
      onEvent: () => () => {},
      getMetrics: () => ({
        connection: {
          connectionAttempts: 0,
          successfulConnections: 0,
          totalEventsReceived: 0,
          totalErrors: 0,
          currentReconnectDelay: 0,
        },
        coalescer: {
          eventsProcessed: 0,
          eventsDropped: 0,
          batchesCreated: 0,
          averageBatchSize: 0,
          queueSize: 0,
          isScheduled: false,
        },
      }),
      eventBus: {},
    }),
  };
});

vi.mock("@/views/home-view/components/clone-dialog", () => {
  return {
    CloneDialog: () => null,
  };
});
vi.mock("@/views/home-view/components/new-workspace-dialog", () => {
  return {
    NewWorkspaceDialog: () => null,
  };
});

async function flushAll(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("Integration: Home + Workspace Provider Flow", () => {
  let container: HTMLDivElement;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockedNavigate.mockReset();
    mockedParams.id = "project-123";

    container = document.createElement("div");
    document.body.appendChild(container);

    Object.defineProperty(window, "saktiCodeAPI", {
      configurable: true,
      writable: true,
      value: {
        server: {
          getConfig: vi.fn().mockResolvedValue({
            baseUrl: "http://127.0.0.1:40523",
            token: "",
          }),
        },
        dialog: {
          openDirectory: vi.fn().mockResolvedValue(null),
        },
        workspace: {
          clone: vi.fn().mockResolvedValue("/tmp/cloned"),
        },
        shell: {
          openExternal: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    originalFetch = global.fetch;
    global.fetch = vi.fn(async input => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/workspaces")) {
        return new Response(
          JSON.stringify({
            workspaces: [
              {
                id: "project-123",
                name: "Project Alpha",
                path: "/tmp/project-alpha",
                lastOpenedAt: new Date("2026-02-12T00:00:00.000Z").toISOString(),
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url.endsWith("/api/workspaces/archived")) {
        return new Response(JSON.stringify({ workspaces: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/workspaces/project-123")) {
        return new Response(
          JSON.stringify({
            workspace: {
              id: "project-123",
              name: "Project Alpha",
              path: "/tmp/project-alpha",
              lastOpenedAt: new Date("2026-02-12T00:00:00.000Z").toISOString(),
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url.endsWith("/api/workspaces/project-123/touch")) {
        return new Response(
          JSON.stringify({
            workspace: {
              id: "project-123",
              name: "Project Alpha",
              path: "/tmp/project-alpha",
              lastOpenedAt: new Date("2026-02-12T00:00:00.000Z").toISOString(),
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (url.includes("/api/vcs/workspaces-dir")) {
        return new Response(JSON.stringify({ path: "/tmp/workspaces/project-alpha/worktrees" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/api/sessions")) {
        return new Response(JSON.stringify({ sessions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    container.remove();
    vi.restoreAllMocks();
  });

  function ChatProbe() {
    const { chat } = useChatContext();
    return <div data-testid="chat-probe">{chat.streaming.status()}</div>;
  }

  function WorkspaceRouteHarness() {
    const ctx = useWorkspace();
    const chatClient = createMemo(() => ctx.client());
    const hasWorkspace = createMemo(() => ctx.workspace().length > 0);
    const canRenderChat = createMemo(() => Boolean(chatClient()) && hasWorkspace());

    return (
      <Show when={canRenderChat()}>
        <ChatProvider
          client={chatClient()!}
          workspace={() => ctx.workspace()}
          sessionId={ctx.activeTaskSessionId}
          onSessionIdReceived={id => {
            if (id !== ctx.activeTaskSessionId()) {
              ctx.setActiveTaskSessionId(id);
            }
          }}
        >
          <ChatProbe />
        </ChatProvider>
      </Show>
    );
  }

  it("clicking recent project navigates to workspace", async () => {
    const view = render(() => <HomeView />, { container });
    await flushAll();

    const projectCard = container.querySelector('[data-test="workspace-card"]');
    expect(projectCard).toBeTruthy();

    projectCard!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAll();

    expect(mockedNavigate).toHaveBeenCalledWith("/workspace/project-123");

    view.unmount();
  });

  it("mounts workspace with app/store/chat providers without useStores runtime error", async () => {
    sessionStorage.setItem(
      "workspace:project-123",
      JSON.stringify({
        projectId: "project-123",
        path: "/tmp/project-alpha",
        name: "Project Alpha",
      })
    );

    const consoleErrors: string[] = [];
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const serialized = args
        .map(arg => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");
      consoleErrors.push(serialized);
    });

    const view = render(
      () => (
        <AppProvider config={{ baseUrl: "http://127.0.0.1:40523", token: "" }}>
          <WorkspaceProvider>
            <WorkspaceRouteHarness />
          </WorkspaceProvider>
        </AppProvider>
      ),
      { container }
    );

    await flushAll();
    await flushAll();

    expect(container.querySelector('[data-testid="chat-probe"]')).toBeTruthy();
    expect(
      consoleErrors.some(msg => msg.includes("useStores must be used within StoreProvider"))
    ).toBe(false);

    consoleErrorSpy.mockRestore();
    view.unmount();
  });
});
