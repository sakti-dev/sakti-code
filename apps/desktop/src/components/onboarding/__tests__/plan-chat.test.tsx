import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  loadChat: vi.fn(),
  clearPendingTransition: vi.fn(),
  confirmTransition: vi.fn(async () => ({ ok: true, instruction: null })),
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
  pendingTransition: null as null | { to: string; body: string },
  sessionMeta: {} as Record<
    string,
    { profileId: string | null; changeName: string | null; worktreePath: string | null }
  >,
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      loadChat: mocks.loadChat,
      confirmTransition: mocks.confirmTransition,
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
          pendingTransition: mocks.pendingTransition,
        },
        actions: { clearPendingTransition: mocks.clearPendingTransition },
      }),
    },
    server: {
      store: {
        sessions: mocks.sessionMeta,
      },
    },
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
    mocks.pendingTransition = null;
    mocks.sessionMeta = {};
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

  it("carries worktreePath from the confirmed plan session to the new mission", async () => {
    mocks.pendingTransition = { to: "mission", body: "Build the thing\n\nDetails" };
    mocks.sessionMeta.s1 = {
      profileId: null,
      changeName: "add-feature",
      worktreePath: "/tmp/sakti/projects/app--add-feature",
    };

    render(() => <PlanChat projectId="p1" sessionId="s1" />);

    const create = await screen.findByRole("button", { name: "Create" });
    fireEvent.click(create);

    await waitFor(() => {
      expect(mocks.confirmTransition).toHaveBeenCalledWith(
        "s1",
        "mission",
        "Build the thing\n\nDetails",
        "approve",
      );
      expect(mocks.createSession).toHaveBeenCalledWith(
        "p1",
        "Build the thing",
        "add-feature",
        "/tmp/sakti/projects/app--add-feature",
      );
    });
  });

  it("does not create a mission when confirmTransition fails", async () => {
    mocks.pendingTransition = { to: "mission", body: "Build the thing" };
    mocks.confirmTransition.mockResolvedValueOnce({ ok: false, instruction: null });
    render(() => <PlanChat projectId="p1" sessionId="s1" />);

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(mocks.confirmTransition).toHaveBeenCalledWith(
        "s1",
        "mission",
        "Build the thing",
        "approve",
      );
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.clearPendingTransition).not.toHaveBeenCalled();
    expect(mocks.openSessionTab).not.toHaveBeenCalled();
    expect(mocks.sendPrompt).not.toHaveBeenCalled();
  });

  it("ignores repeated create clicks while confirmation is in flight", async () => {
    mocks.pendingTransition = { to: "mission", body: "Build the thing" };
    mocks.sessionMeta.s1 = {
      profileId: null,
      changeName: "add-feature",
      worktreePath: "/tmp/sakti/projects/app--add-feature",
    };
    let resolveConfirm: ((value: { ok: true; instruction: null }) => void) | undefined;
    mocks.confirmTransition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    render(() => <PlanChat projectId="p1" sessionId="s1" />);

    const create = await screen.findByRole("button", { name: "Create" });
    fireEvent.click(create);
    fireEvent.click(create);

    expect(mocks.confirmTransition).toHaveBeenCalledTimes(1);

    resolveConfirm?.({ ok: true, instruction: null });

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledTimes(1);
      expect(mocks.sendPrompt).toHaveBeenCalledWith("mission-1", "Build the thing");
    });
  });
});
