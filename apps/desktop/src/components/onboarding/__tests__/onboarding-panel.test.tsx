import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { OnboardingPanel } from "../onboarding-panel";

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    sessions: {
      get: () => ({
        store: { messageOrder: [], messages: {}, streaming: { phase: "idle" } },
      }),
    },
  }),
}));

describe("OnboardingPanel", () => {
  it("renders welcome state when no messages", () => {
    const { getByText } = render(() => (
      <OnboardingPanel intakeSessionId="s1" projectId="p1" />
    ));
    expect(getByText("How can I help?")).toBeTruthy();
  });

  it("renders timeline placeholder when intakeSessionId is null", () => {
    const { getByText } = render(() => (
      <OnboardingPanel intakeSessionId={null} projectId="p1" />
    ));
    expect(getByText("How can I help?")).toBeTruthy();
  });

  it("renders chat placeholders", () => {
    const { getByText } = render(() => (
      <OnboardingPanel intakeSessionId="s1" projectId="p1" />
    ));
    expect(getByText("Chat input coming in Phase 2")).toBeTruthy();
  });
});
