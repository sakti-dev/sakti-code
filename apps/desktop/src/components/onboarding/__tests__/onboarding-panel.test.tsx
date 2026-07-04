import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { OnboardingPanel } from "../onboarding-panel";

const mocks = vi.hoisted(() => ({
  loadChat: vi.fn(),
  listChildIntakes: vi.fn(
    async () => [] as Array<{ id: string; title: string | null; updatedAt: number }>,
  ),
  createChildIntake: vi.fn(async () => ({ id: "new-1" })),
  confirmAsk: vi.fn(async () => true),
  createSession: vi.fn(async () => ({ id: "mission-1" })),
  sendPrompt: vi.fn(),
  clearPendingAsk: vi.fn(),
}));

vi.mock("~/stores/workspace/tab-store", () => ({
  setTabSession: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      sendPrompt: mocks.sendPrompt,
      loadChat: mocks.loadChat,
      confirmAsk: mocks.confirmAsk,
      createSession: mocks.createSession,
      createChildIntake: mocks.createChildIntake,
      listChildIntakes: mocks.listChildIntakes,
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
    server: { store: { sessions: {} } },
  }),
}));

const CHILD_A = { id: "child-a", title: "First intake", updatedAt: 1000, kind: "intake" } as const;
const CHILD_B = { id: "child-b", title: "Second intake", updatedAt: 2000, kind: "intake" } as const;

describe("OnboardingPanel (grid)", () => {
  beforeEach(() => {
    mocks.loadChat.mockClear();
    mocks.listChildIntakes.mockClear();
    mocks.createChildIntake.mockClear();
    mocks.sendPrompt.mockClear();
  });

  it("renders a card per child intake", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([CHILD_A, CHILD_B]);
    render(() => <OnboardingPanel projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First intake")).toBeTruthy());
    expect(screen.getByText("Second intake")).toBeTruthy();
  });

  it("renders a New intake button", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([]);
    render(() => <OnboardingPanel projectId="p1" />);

    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /New intake/i })).toBeTruthy(),
    );
  });

  it("creates a new child and opens its chat when New intake is clicked", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([]);
    render(() => <OnboardingPanel projectId="p1" />);

    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /New intake/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /New intake/i }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mocks.createChildIntake).toHaveBeenCalledWith("p1");
    // Chat view is now shown for the new child.
    await vi.waitFor(() => expect(mocks.loadChat).toHaveBeenCalledWith("new-1"));
  });

  it("opens a child's chat when its card is clicked", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([CHILD_A]);
    render(() => <OnboardingPanel projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First intake")).toBeTruthy());
    fireEvent.click(screen.getByText("First intake"));
    await new Promise((r) => setTimeout(r, 0));

    await vi.waitFor(() => expect(mocks.loadChat).toHaveBeenCalledWith("child-a"));
  });

  it("returns to the grid when Back is clicked from a child chat", async () => {
    mocks.listChildIntakes.mockResolvedValueOnce([CHILD_A]);
    render(() => <OnboardingPanel projectId="p1" />);

    await vi.waitFor(() => expect(screen.getByText("First intake")).toBeTruthy());
    fireEvent.click(screen.getByText("First intake"));
    await new Promise((r) => setTimeout(r, 0));
    await vi.waitFor(() => expect(screen.getByText(/Back/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Back/i));

    // Grid is shown again.
    await vi.waitFor(() => expect(screen.getByText("First intake")).toBeTruthy());
  });
});
