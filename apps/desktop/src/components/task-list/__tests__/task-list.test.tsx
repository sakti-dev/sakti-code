import { TaskList } from "@/components/task-list/task-list";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("TaskList", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("filters tasks by query", () => {
    const { container } = render(() => (
      <TaskList
        tasks={[
          {
            taskSessionId: "ts-1",
            title: "Design spec",
            status: "specifying",
            specType: "quick",
            lastActivityAt: new Date().toISOString(),
          },
          {
            taskSessionId: "ts-2",
            title: "Implement routes",
            status: "implementing",
            specType: "comprehensive",
            lastActivityAt: new Date().toISOString(),
          },
        ]}
      />
    ));

    const input = container.querySelector('input[aria-label="Search tasks"]') as HTMLInputElement;
    input.value = "implement";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(container.textContent).toContain("Implement routes");
    expect(container.textContent).not.toContain("Design spec");
  });

  it("calls onTaskSelect when a task card is clicked", () => {
    const onTaskSelect = vi.fn();
    const { container } = render(() => (
      <TaskList
        tasks={[
          {
            taskSessionId: "ts-3",
            title: "Create homepage",
            status: "researching",
            specType: null,
            lastActivityAt: new Date().toISOString(),
          },
        ]}
        onTaskSelect={onTaskSelect}
      />
    ));

    const cardButton = container.querySelector("button") as HTMLButtonElement;
    cardButton.click();

    expect(onTaskSelect).toHaveBeenCalledWith("ts-3");
  });

  it("shows empty state when there are no tasks", () => {
    const { container } = render(() => <TaskList tasks={[]} />);

    expect(container.textContent).toContain("No task sessions found");
  });
});
