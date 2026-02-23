import { TaskList } from "@/views/workspace-view/right-side/tasks/task-list";
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

describe("TaskList", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  const setup = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
  };

  const cleanup = () => {
    dispose?.();
    document.body.removeChild(container);
  };

  it("should render tasks when provided", () => {
    setup();
    const tasks = [
      { id: "1", title: "Task 1", status: "open" as const, priority: 2 },
      { id: "2", title: "Task 2", status: "in_progress" as const, priority: 1 },
    ];

    ({ unmount: dispose } = render(() => <TaskList tasks={tasks} />, { container }));

    expect(container.textContent).toContain("Task 1");
    expect(container.textContent).toContain("Task 2");
    cleanup();
  });

  it("should not render when no tasks", () => {
    setup();
    ({ unmount: dispose } = render(() => <TaskList tasks={[]} />, { container }));

    expect(container.textContent).toBe("");
    cleanup();
  });
});
