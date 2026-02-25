import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  activeTaskSessionId: null as string | null,
  setActiveTaskSessionId: vi.fn(),
  refreshTaskSessions: vi.fn(),
  startListening: vi.fn(),
}));

vi.mock("@/core/chat/hooks", () => ({
  useTasks: () => ({
    startListening: mockState.startListening,
    tasks: () => [],
  }),
}));

vi.mock("@corvu/resizable", () => {
  const Resizable = (props: { children: unknown }) => (
    <div data-testid="resizable">{props.children}</div>
  );

  (Resizable as unknown as {
    Panel: (props: { children: unknown }) => JSX.Element;
  }).Panel = (props: { children: unknown }) => (
    <div data-testid="resizable-panel">{props.children}</div>
  );

  return { default: Resizable };
});

vi.mock("@/views/homepage-view/homepage-view", () => ({
  HomepageView: () => <div data-testid="homepage-view">homepage</div>,
}));

vi.mock("@/views/workspace-view/left-side/left-side", () => ({
  LeftSide: () => <div data-testid="task-layout-left">left</div>,
}));

vi.mock("@/views/workspace-view/chat-area/chat-area", () => ({
  ChatArea: () => <div data-testid="task-layout-chat">chat</div>,
}));

vi.mock("@/views/workspace-view/right-side/right-side", () => ({
  ContextPanel: () => <div data-testid="task-layout-right">right</div>,
}));

vi.mock("@/components/ui/resizeable-handle", () => ({
  ResizeableHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/state/providers", () => ({
  WorkspaceProvider: (props: { children: unknown }) => <>{props.children}</>,
  WorkspaceChatProvider: (props: { children: unknown }) => <>{props.children}</>,
  useWorkspace: () => ({
    client: () =>
      ({
        listProjectKeypoints: async () => [],
      }) as object,
    workspace: () => "/repo",
    projectId: () => "ws-1",
    activeTaskSessionId: () => mockState.activeTaskSessionId,
    setActiveTaskSessionId: mockState.setActiveTaskSessionId,
    refreshTaskSessions: mockState.refreshTaskSessions,
    taskSessions: () => [
      {
        taskSessionId: "ts-1",
        title: "Task One",
        taskStatus: "researching",
        specType: null,
        lastActivityAt: new Date().toISOString(),
      },
    ],
  }),
}));

import { WorkspaceViewInner } from "@/views/workspace-view/index";

describe("WorkspaceView mode switching", () => {
  beforeEach(() => {
    mockState.activeTaskSessionId = null;
    mockState.setActiveTaskSessionId.mockReset();
    mockState.refreshTaskSessions.mockReset();
    mockState.startListening.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows homepage when no active task session", () => {
    const { getByTestId, queryByTestId } = render(() => <WorkspaceViewInner />);

    expect(getByTestId("homepage-view")).toBeTruthy();
    expect(queryByTestId("task-layout-left")).toBeNull();
  });

  it("shows task-session layout when active task session exists", () => {
    mockState.activeTaskSessionId = "ts-1";
    const { getByTestId, queryByTestId } = render(() => <WorkspaceViewInner />);

    expect(getByTestId("task-layout-left")).toBeTruthy();
    expect(getByTestId("task-layout-chat")).toBeTruthy();
    expect(queryByTestId("homepage-view")).toBeNull();
  });

  it("home button sets active task session to null", () => {
    mockState.activeTaskSessionId = "ts-1";
    const { container } = render(() => <WorkspaceViewInner />);

    const homeButton = container.querySelector('button[aria-label="Go home"]') as HTMLButtonElement;
    homeButton.click();

    expect(mockState.setActiveTaskSessionId).toHaveBeenCalledWith(null);
  });
});
