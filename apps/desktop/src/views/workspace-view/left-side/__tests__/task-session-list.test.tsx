import { SessionList } from "@/views/workspace-view/left-side/session-list";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Task session sidebar list", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const tasks = [
    {
      id: "ts-1",
      taskSessionId: "ts-1",
      title: "Research architecture",
      lastActivityAt: new Date().toISOString(),
      status: "active" as const,
    },
    {
      id: "ts-2",
      taskSessionId: "ts-2",
      title: "Draft implementation",
      lastActivityAt: new Date().toISOString(),
      status: "active" as const,
    },
  ];

  it("renders tasks", () => {
    const { container } = render(() => <SessionList sessions={tasks} />);

    expect(container.textContent).toContain("Research architecture");
    expect(container.textContent).toContain("Draft implementation");
  });

  it("applies active styling for selected task", () => {
    const { container } = render(() => <SessionList sessions={tasks} activeSessionId="ts-1" />);

    const activeCard = container.querySelector('[data-component="task-session-card"].animate-breathe');
    expect(activeCard).not.toBeNull();
    expect(activeCard?.textContent).toContain("Research architecture");
  });

  it("calls onSessionClick when task is clicked", () => {
    const onSessionClick = vi.fn();
    const { container } = render(() => (
      <SessionList sessions={tasks} onSessionClick={onSessionClick} />
    ));

    const cards = container.querySelectorAll('[data-component="task-session-card"]');
    (cards[0] as HTMLElement).click();

    expect(onSessionClick).toHaveBeenCalledWith(expect.objectContaining({ taskSessionId: "ts-1" }));
  });
});
