import { HomepageView } from "@/views/homepage-view/homepage-view";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

describe("HomepageView", () => {
  beforeAll(() => {
    if (!("ResizeObserver" in globalThis)) {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      );
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders task list and welcome panel", () => {
    const { container } = render(() => (
      <HomepageView
        tasks={[
          {
            taskSessionId: "ts-1",
            title: "Prepare research",
            status: "researching",
            specType: null,
            lastActivityAt: new Date().toISOString(),
          },
        ]}
      />
    ));

    expect(container.textContent).toContain("Prepare research");
    expect(container.textContent).toContain("Welcome back");
  });

  it("renders big chat input", () => {
    const { container } = render(() => <HomepageView tasks={[]} />);

    expect(container.querySelector('textarea[aria-label="Task input"]')).not.toBeNull();
  });

  it("calls onTaskSelect when a task is selected", () => {
    const onTaskSelect = vi.fn();
    const { container } = render(() => (
      <HomepageView
        tasks={[
          {
            taskSessionId: "ts-2",
            title: "Draft design",
            status: "specifying",
            specType: "quick",
            lastActivityAt: new Date().toISOString(),
          },
        ]}
        onTaskSelect={onTaskSelect}
      />
    ));

    const taskButton = container.querySelector("button[data-active]") as HTMLButtonElement;
    taskButton.click();

    expect(onTaskSelect).toHaveBeenCalledWith("ts-2");
  });

  it("calls onResearchAction when research action is clicked", () => {
    const onResearchAction = vi.fn();
    const { container } = render(() => (
      <HomepageView
        tasks={[]}
        researchSummary="Research output"
        onResearchAction={onResearchAction}
      />
    ));

    const actionButton = container.querySelector(
      'button[data-action="wizard:start:comprehensive"]'
    ) as HTMLButtonElement;
    actionButton.click();

    expect(onResearchAction).toHaveBeenCalledWith("wizard:start:comprehensive");
  });

  it("renders research error state", () => {
    const { container } = render(() => <HomepageView tasks={[]} researchError="Invalid handoff" />);

    expect(container.textContent).toContain("Invalid handoff");
  });
});
