import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  listChildIntakes: vi.fn(
    async () => [] as Array<{ id: string; title: string | null; updatedAt: number }>,
  ),
  openDraftIntakeTab: vi.fn(),
  openSessionTab: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      listChildIntakes: mocks.listChildIntakes,
    },
  }),
}));

vi.mock("~/stores/workspace/session-tab-store", () => ({
  openDraftIntakeTab: mocks.openDraftIntakeTab,
  openSessionTab: mocks.openSessionTab,
}));

import { IntakeGrid } from "../intake-grid";

const CHILD_A = { id: "child-a", title: "First intake", updatedAt: 1000, kind: "intake" as const };
const CHILD_B = { id: "child-b", title: "Second intake", updatedAt: 2000, kind: "intake" as const };

describe("IntakeGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a card per child intake", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([CHILD_A, CHILD_B]);
    render(() => <IntakeGrid projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First intake")).toBeTruthy());
    expect(screen.getByText("Second intake")).toBeTruthy();
  });

  it("renders New intake button", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([]);
    render(() => <IntakeGrid projectId="p1" />);

    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /New intake/i })).toBeTruthy(),
    );
  });

  it("opens existing intake as session tab when card is clicked", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([CHILD_A]);
    render(() => <IntakeGrid projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First intake")).toBeTruthy());
    fireEvent.click(screen.getByText("First intake"));

    expect(mocks.openSessionTab).toHaveBeenCalledWith("p1", "child-a", "intake");
  });

  it("opens a draft intake tab (no DB session) when New intake is clicked", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([]);
    render(() => <IntakeGrid projectId="p1" />);

    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /New intake/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /New intake/i }));

    expect(mocks.openDraftIntakeTab).toHaveBeenCalledWith("p1");
    expect(mocks.openSessionTab).not.toHaveBeenCalled();
  });
});
