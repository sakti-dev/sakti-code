import { render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { OnboardingPanel } from "../onboarding-panel";

// Hoisted so the same fn instance is shared between the mocked useStore and
// the test assertions.
const mocks = vi.hoisted(() => ({
  loadChat: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: { sendPrompt: vi.fn(), loadChat: mocks.loadChat },
    sessions: {
      get: () => ({
        store: {
          streaming: { phase: "idle" },
          turns: [],
        },
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
});
