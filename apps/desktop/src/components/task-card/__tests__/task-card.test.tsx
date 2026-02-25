import { TaskCard } from "@/components/task-card/task-card";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("TaskCard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders task fields and status", () => {
    const { container } = render(() => (
      <TaskCard
        task={{
          taskSessionId: "ts-1",
          title: "Plan homepage flow",
          status: "specifying",
          specType: "quick",
          lastActivityAt: new Date().toISOString(),
        }}
      />
    ));

    expect(container.textContent).toContain("Plan homepage flow");
    expect(container.textContent).toContain("specifying");
    expect(container.textContent).toContain("quick");
  });

  it("calls onSelect with task session id", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <TaskCard
        task={{
          taskSessionId: "ts-2",
          title: "Implement API wiring",
          status: "implementing",
          specType: "comprehensive",
          lastActivityAt: new Date().toISOString(),
        }}
        onSelect={onSelect}
      />
    ));

    const button = container.querySelector("button") as HTMLButtonElement;
    button.click();

    expect(onSelect).toHaveBeenCalledWith("ts-2");
  });
});
