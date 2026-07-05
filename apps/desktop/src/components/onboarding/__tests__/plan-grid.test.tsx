import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  listChildPlans: vi.fn(
    async () => [] as Array<{ id: string; title: string | null; updatedAt: number }>,
  ),
  openDraftPlanTab: vi.fn(),
  openSessionTab: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      listChildPlans: mocks.listChildPlans,
    },
  }),
}));

vi.mock("~/stores/workspace/session-tab-store", () => ({
  openDraftPlanTab: mocks.openDraftPlanTab,
  openSessionTab: mocks.openSessionTab,
}));

import { PlanGrid } from "../plan-grid";

const CHILD_A = { id: "child-a", title: "First plan", updatedAt: 1000, kind: "plan" as const };
const CHILD_B = { id: "child-b", title: "Second plan", updatedAt: 2000, kind: "plan" as const };

describe("PlanGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a card per child plan", async () => {
    mocks.listChildPlans.mockResolvedValueOnce([CHILD_A, CHILD_B]);
    render(() => <PlanGrid projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First plan")).toBeTruthy());
    expect(screen.getByText("Second plan")).toBeTruthy();
  });

  it("renders New plan button", async () => {
    mocks.listChildPlans.mockResolvedValueOnce([]);
    render(() => <PlanGrid projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByRole("button", { name: /New plan/i })).toBeTruthy());
  });

  it("opens existing plan as session tab when card is clicked", async () => {
    mocks.listChildPlans.mockResolvedValueOnce([CHILD_A]);
    render(() => <PlanGrid projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First plan")).toBeTruthy());
    fireEvent.click(screen.getByText("First plan"));

    expect(mocks.openSessionTab).toHaveBeenCalledWith("p1", "child-a", "plan");
  });

  it("opens a draft plan tab (no DB session) when New plan is clicked", async () => {
    mocks.listChildPlans.mockResolvedValueOnce([]);
    render(() => <PlanGrid projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByRole("button", { name: /New plan/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /New plan/i }));

    expect(mocks.openDraftPlanTab).toHaveBeenCalledWith("p1");
    expect(mocks.openSessionTab).not.toHaveBeenCalled();
  });
});
