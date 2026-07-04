import { render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  loadChat: vi.fn(),
  clearPendingAsk: vi.fn(),
  confirmAsk: vi.fn(async () => true),
  createSession: vi.fn(async () => ({ id: "mission-1" })),
  sendPrompt: vi.fn(),
  closeSessionTab: vi.fn(),
  openSessionTab: vi.fn(),
  getSessionTabIndex: vi.fn(() => 1),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      loadChat: mocks.loadChat,
      confirmAsk: mocks.confirmAsk,
      createSession: mocks.createSession,
      sendPrompt: mocks.sendPrompt,
    },
    sessions: {
      get: () => ({
        store: {
          streaming: { phase: "idle" },
          turns: [],
          pendingAsk: null,
        },
        actions: { clearPendingAsk: mocks.clearPendingAsk },
      }),
    },
    server: { store: { sessions: {} } },
  }),
}));

vi.mock("~/stores/workspace/session-tab-store", () => ({
  closeSessionTab: mocks.closeSessionTab,
  openSessionTab: mocks.openSessionTab,
  getSessionTabIndex: mocks.getSessionTabIndex,
}));

import { IntakeChat } from "../intake-chat";

describe("IntakeChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads chat on mount", () => {
    render(() => <IntakeChat projectId="p1" sessionId="s1" />);
    expect(mocks.loadChat).toHaveBeenCalledWith("s1");
  });

  it("does not render a Back button", () => {
    render(() => <IntakeChat projectId="p1" sessionId="s1" />);
    expect(screen.queryByText(/Back/i)).toBeNull();
  });
});
