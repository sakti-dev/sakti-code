import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { OnboardingPanel } from "../onboarding-panel";

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: { sendPrompt: vi.fn() },
    sessions: {
      get: () => ({
        store: {
          messageOrder: [],
          messages: {},
          streaming: { phase: "idle" },
        },
      }),
    },
    server: { store: { sessions: {} } },
    api: {
      api: {
        models: {
          available: {
            $get: async () => ({ ok: false, json: async () => [] }),
          },
        },
      },
    },
  }),
}));

describe("OnboardingPanel", () => {
  it("renders welcome state when no messages", () => {
    const { getByText } = render(() => (
      <OnboardingPanel intakeSessionId="s1" projectId="p1" />
    ));
    expect(getByText("No messages yet")).toBeTruthy();
  });

  it("renders welcome state when intakeSessionId is null", () => {
    const { getByText } = render(() => (
      <OnboardingPanel intakeSessionId={null} projectId="p1" />
    ));
    expect(getByText("No messages yet")).toBeTruthy();
  });

  it("renders chat input", () => {
    const { getByPlaceholderText } = render(() => (
      <OnboardingPanel intakeSessionId="s1" projectId="p1" />
    ));
    expect(
      getByPlaceholderText("Ask anything about this project…")
    ).toBeTruthy();
  });
});
