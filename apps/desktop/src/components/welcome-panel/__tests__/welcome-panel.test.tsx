import { WelcomePanel } from "@/components/welcome-panel/welcome-panel";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";

describe("WelcomePanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders welcome message", () => {
    const { container } = render(() => <WelcomePanel />);

    expect(container.textContent).toContain("Welcome back");
    expect(container.textContent).toContain("Start a new task from the homepage");
  });

  it("renders keypoints when provided", () => {
    const { container } = render(() => (
      <WelcomePanel
        keypoints={[
          {
            id: "k1",
            taskTitle: "Set up task-session API",
            milestone: "completed",
            completedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            summary: "Task-session routes were integrated.",
          },
        ]}
      />
    ));

    expect(container.textContent).toContain("Recent progress");
    expect(container.textContent).toContain("Set up task-session API");
    expect(container.textContent).toContain("Task-session routes were integrated.");
  });

  it("hides progress section when keypoints are empty", () => {
    const { container } = render(() => <WelcomePanel keypoints={[]} />);

    expect(container.querySelector('[data-section="progress"]')).toBeNull();
  });
});
