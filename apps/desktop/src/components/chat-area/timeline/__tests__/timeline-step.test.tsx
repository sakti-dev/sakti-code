import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import { TimelineStep } from "../timeline-step.tsx";

describe("TimelineStep", () => {
  it("renders icon and children", () => {
    const { container } = render(() => (
      <TimelineStep icon={<span data-testid="icon" />} isLast={false}>
        <span>Content</span>
      </TimelineStep>
    ));
    expect(screen.getByText("Content")).toBeTruthy();
    expect(container.querySelector("[data-testid='icon']")).toBeTruthy();
  });

  it("renders connector line when not last", () => {
    const { container } = render(() => (
      <TimelineStep icon={<span />} isLast={false}>
        <span>X</span>
      </TimelineStep>
    ));
    expect(container.querySelector("[data-slot='timeline-connector']")).not.toBeNull();
  });

  it("does NOT render connector line when last", () => {
    const { container } = render(() => (
      <TimelineStep icon={<span />} isLast={true}>
        <span>X</span>
      </TimelineStep>
    ));
    expect(container.querySelector("[data-slot='timeline-connector']")).toBeNull();
  });
});
