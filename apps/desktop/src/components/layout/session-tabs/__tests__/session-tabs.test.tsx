import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type MockSessionTab = {
  kind: "home" | "mission" | "plan";
  sessionId: string | null;
};

const mocks = vi.hoisted(() => ({
  ensureProjectTabs: vi.fn(),
  getSessionTabs: vi.fn<() => MockSessionTab[]>(() => [
    { kind: "home" as const, sessionId: null },
    { kind: "plan" as const, sessionId: "s1" },
  ]),
  getActiveSessionIndex: vi.fn(() => 0),
  switchSessionTab: vi.fn(),
  closeSessionTab: vi.fn(),
  sessions: {
    s1: {
      title: "Plan the migration",
    },
    m1: {
      title: "Build the migration",
    },
  },
}));

vi.mock("~/stores/workspace/session-tab-store", () => mocks);
vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    server: {
      store: {
        sessions: mocks.sessions,
      },
    },
  }),
}));

import SessionTabs from "../session-tabs";

describe("SessionTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a tab per session tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Plan the migration")).toBeTruthy();
  });

  it("does not render close button on Home tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    const homeTab = screen.getByText("Home").closest("[role='tab']");
    expect(homeTab?.querySelector("button[aria-label*='Close']")).toBeNull();
  });

  it("renders close button on plan tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    expect(screen.getByLabelText("Close Plan the migration tab")).toBeTruthy();
  });

  it("switches tab on click", () => {
    render(() => <SessionTabs projectId="p1" />);
    fireEvent.click(screen.getByText("Plan the migration"));
    expect(mocks.switchSessionTab).toHaveBeenCalledWith("p1", 1);
  });

  it("closes tab on close button click", () => {
    render(() => <SessionTabs projectId="p1" />);
    fireEvent.click(screen.getByLabelText("Close Plan the migration tab"));
    expect(mocks.closeSessionTab).toHaveBeenCalledWith("p1", 1);
  });

  it("shows the mission session title in the tab bar", () => {
    mocks.getSessionTabs.mockReturnValueOnce([
      { kind: "home", sessionId: null },
      { kind: "mission", sessionId: "m1" },
    ]);
    render(() => <SessionTabs projectId="p1" />);
    expect(screen.getByText("Build the migration")).toBeTruthy();
  });
});
