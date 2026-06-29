import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
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
        auth: { $get: async () => ({ ok: false, json: async () => [] }) },
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
    const { getByText } = render(() => (
      <OnboardingPanel intakeSessionId="s1" projectId="p1" />
    ));
    // ChipInput renders the placeholder as an overlay <div> (contenteditable
    // has no native placeholder attribute), so look it up by text.
    expect(getByText("Ask anything about this project…")).toBeTruthy();
  });
});
