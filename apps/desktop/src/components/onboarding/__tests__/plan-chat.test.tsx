import { render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  loadChat: vi.fn(),
  clearPendingAsk: vi.fn(),
  confirmAsk: vi.fn(async () => true),
  createSession: vi.fn(async () => ({ id: "mission-1" })),
  createChildPlan: vi.fn(async () => ({ id: "plan-1" })),
  sendPrompt: vi.fn(),
  selectProfile: vi.fn(async () => undefined),
  closeSessionTab: vi.fn(),
  openSessionTab: vi.fn(),
  getSessionTabIndex: vi.fn(() => 1),
  promoteDraftPlan: vi.fn(),
  getDraft: vi.fn<(projectId: string) => string | undefined>(() => undefined),
  clearDraft: vi.fn(),
  onSend: null as null | ((t: string) => void | Promise<void>),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      loadChat: mocks.loadChat,
      confirmAsk: mocks.confirmAsk,
      createSession: mocks.createSession,
      createChildPlan: mocks.createChildPlan,
      sendPrompt: mocks.sendPrompt,
      selectProfile: mocks.selectProfile,
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
    server: { store: { sessions: {} as Record<string, { profileId: string | null }> } },
  }),
}));

vi.mock("~/stores/workspace/session-tab-store", () => ({
  closeSessionTab: mocks.closeSessionTab,
  openSessionTab: mocks.openSessionTab,
  getSessionTabIndex: mocks.getSessionTabIndex,
  promoteDraftPlan: mocks.promoteDraftPlan,
}));

vi.mock("~/stores/workspace/draft-profile-store", () => ({
  getDraftProfile: mocks.getDraft,
  clearDraftProfile: mocks.clearDraft,
}));

vi.mock("~/components/chat-input/chat-input", () => ({
  ChatInput: (props: { onSend?: (t: string) => void | Promise<void> }) => {
    mocks.onSend = props.onSend ?? null;
    return null;
  },
}));

import { PlanChat } from "../plan-chat";

describe("PlanChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDraft.mockImplementation(() => undefined);
    mocks.onSend = null;
  });

  it("loads chat on mount", () => {
    render(() => <PlanChat projectId="p1" sessionId="s1" />);
    expect(mocks.loadChat).toHaveBeenCalledWith("s1");
  });

  it("does not render a Back button", () => {
    render(() => <PlanChat projectId="p1" sessionId="s1" />);
    expect(screen.queryByText(/Back/i)).toBeNull();
  });

  it("draft send creates a plan session and sends the prompt", async () => {
    render(() => <PlanChat projectId="p1" sessionId={null} />);
    expect(mocks.onSend).not.toBeNull();
    await mocks.onSend!("build a todo app");
    expect(mocks.createChildPlan).toHaveBeenCalledWith("p1");
    expect(mocks.sendPrompt).toHaveBeenCalledWith("plan-1", "build a todo app");
  });

  it("applies a per-project draft profile to the created plan session", async () => {
    mocks.getDraft.mockImplementation(() => "profile-fast");
    render(() => <PlanChat projectId="p1" sessionId={null} />);
    await mocks.onSend!("hello");
    expect(mocks.selectProfile).toHaveBeenCalledWith("plan-1", "profile-fast");
    expect(mocks.clearDraft).toHaveBeenCalledWith("p1");
  });

  it("does not call selectProfile when no draft profile is set", async () => {
    render(() => <PlanChat projectId="p1" sessionId={null} />);
    await mocks.onSend!("hello");
    expect(mocks.selectProfile).not.toHaveBeenCalled();
    expect(mocks.clearDraft).not.toHaveBeenCalled();
  });
});
