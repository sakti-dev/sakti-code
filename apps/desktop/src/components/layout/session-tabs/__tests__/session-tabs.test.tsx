import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  ensureProjectTabs: vi.fn(),
  getSessionTabs: vi.fn(() => [
    { kind: "home" as const, sessionId: null },
    { kind: "intake" as const, sessionId: "s1" },
  ]),
  getActiveSessionIndex: vi.fn(() => 0),
  switchSessionTab: vi.fn(),
  closeSessionTab: vi.fn(),
}));

vi.mock("~/stores/workspace/session-tab-store", () => mocks);

import SessionTabs from "../session-tabs";

describe("SessionTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a tab per session tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Intake")).toBeTruthy();
  });

  it("does not render close button on Home tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    const homeTab = screen.getByText("Home").closest("[role='tab']");
    expect(homeTab?.querySelector("button[aria-label*='Close']")).toBeNull();
  });

  it("renders close button on intake tab", () => {
    render(() => <SessionTabs projectId="p1" />);
    expect(screen.getByLabelText("Close Intake tab")).toBeTruthy();
  });

  it("switches tab on click", () => {
    render(() => <SessionTabs projectId="p1" />);
    fireEvent.click(screen.getByText("Intake"));
    expect(mocks.switchSessionTab).toHaveBeenCalledWith("p1", 1);
  });

  it("closes tab on close button click", () => {
    render(() => <SessionTabs projectId="p1" />);
    fireEvent.click(screen.getByLabelText("Close Intake tab"));
    expect(mocks.closeSessionTab).toHaveBeenCalledWith("p1", 1);
  });
});
