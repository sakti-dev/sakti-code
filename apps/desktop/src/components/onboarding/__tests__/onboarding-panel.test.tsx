import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { OnboardingPanel } from "../onboarding-panel";

// Hoisted so the same fn instance is shared between the mocked useStore and
// the test assertions.
const mocks = vi.hoisted(() => ({
  loadChat: vi.fn(),
  confirmAsk: vi.fn(async () => true),
  createSession: vi.fn(async () => ({ id: "mission-1" })),
  sendPrompt: vi.fn(),
  clearPendingAsk: vi.fn(),
  pendingAsk: null as { kind: string; body: string } | null,
}));

vi.mock("~/stores/workspace/tab-store", () => ({
  setTabSession: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      sendPrompt: mocks.sendPrompt,
      loadChat: mocks.loadChat,
      confirmAsk: mocks.confirmAsk,
      createSession: mocks.createSession,
    },
    sessions: {
      get: () => ({
        store: {
          streaming: { phase: "idle" },
          turns: [],
          pendingAsk: mocks.pendingAsk,
        },
        actions: { clearPendingAsk: mocks.clearPendingAsk },
      }),
    },
    server: { store: { sessions: {} } },
    api: {
      api: {
        auth: { $get: async () => ({ ok: false, json: async () => [] }) },
        profiles: { $get: async () => ({ ok: false, json: async () => [] }) },
        models: {
          available: {
            $get: async () => ({ ok: false, json: async () => [] }),
            ":provider": {
              $get: async () => ({ ok: false, json: async () => [] }),
            },
          },
          connected: {
            $get: async () => ({ ok: false, json: async () => [] }),
          },
        },
      },
    },
  }),
}));

describe("OnboardingPanel", () => {
  // mocks.loadMessages is a single hoisted instance shared across tests —
  // clear call history between cases so "not called" assertions are honest.
  beforeEach(() => {
    mocks.loadChat.mockClear();
    mocks.confirmAsk.mockClear();
    mocks.createSession.mockClear();
    mocks.sendPrompt.mockClear();
    mocks.clearPendingAsk.mockClear();
    mocks.pendingAsk = null;
  });

  it("renders welcome state when no messages", () => {
    render(() => <OnboardingPanel intakeSessionId="s1" projectId="p1" />);
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });

  it("renders welcome state when intakeSessionId is null", () => {
    render(() => <OnboardingPanel intakeSessionId={null} projectId="p1" />);
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });

  it("renders chat input", () => {
    render(() => <OnboardingPanel intakeSessionId="s1" projectId="p1" />);
    expect(screen.getByText("Ask anything about this project…")).toBeTruthy();
  });

  it("loads intake messages when intakeSessionId is set", () => {
    render(() => <OnboardingPanel intakeSessionId="s1" projectId="p1" />);
    expect(mocks.loadChat).toHaveBeenCalledWith("s1");
  });

  it("does not load messages when intakeSessionId is null", () => {
    render(() => <OnboardingPanel intakeSessionId={null} projectId="p1" />);
    expect(mocks.loadChat).not.toHaveBeenCalled();
  });

  it("on Create: confirms the ask (fires graduation) before spawning the mission", async () => {
    mocks.pendingAsk = { kind: "session", body: "Build the thing" };
    render(() => <OnboardingPanel intakeSessionId="child-1" projectId="p1" />);

    fireEvent.click(screen.getByText("Create"));
    // The handler is async (multiple awaits); let the microtask queue drain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // confirmAsk is called first (server-side graduation), then createSession.
    expect(mocks.confirmAsk).toHaveBeenCalledWith(
      "child-1",
      "session",
      "Build the thing",
      "approve",
    );
    expect(mocks.createSession).toHaveBeenCalledWith("p1", "Build the thing");
    expect(mocks.sendPrompt).toHaveBeenCalledWith("mission-1", "Build the thing");
    // confirmAsk must have resolved before createSession was invoked.
    const confirmOrder = mocks.confirmAsk.mock.invocationCallOrder[0]!;
    const createOrder = mocks.createSession.mock.invocationCallOrder[0]!;
    expect(confirmOrder).toBeLessThan(createOrder);
  });

  it("still spawns the mission when graduation (confirmAsk) fails (best-effort)", async () => {
    mocks.pendingAsk = { kind: "session", body: "Build the thing" };
    mocks.confirmAsk.mockResolvedValueOnce(false);
    render(() => <OnboardingPanel intakeSessionId="child-1" projectId="p1" />);

    fireEvent.click(screen.getByText("Create"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.confirmAsk).toHaveBeenCalled();
    // Mission still spawned — graduation must not strand it.
    expect(mocks.createSession).toHaveBeenCalled();
  });
});
