import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { MissionRow } from "../mission-row.tsx";

const baseProps = {
  isActive: false,
  status: "build" as const,
  streamPhase: "idle" as const,
  title: "My Mission",
  updatedAt: Date.now(),
  onClick: () => {},
};

describe("MissionRow", () => {
  it("renders the title and status pill", () => {
    render(() => <MissionRow {...baseProps} />);
    expect(screen.getByText("My Mission")).toBeTruthy();
    expect(screen.getByText("build")).toBeTruthy();
  });

  it("shows 'Untitled mission' when title is null", () => {
    render(() => <MissionRow {...baseProps} title={null} />);
    expect(screen.getByText("Untitled mission")).toBeTruthy();
  });

  it("applies the active left-bar class when active", () => {
    const { container } = render(() => <MissionRow {...baseProps} isActive={true} />);
    const row = container.querySelector('[data-component="mission-row"]');
    expect(row?.className).toContain("border-l-primary");
  });

  it("fires onClick when the row is clicked", () => {
    const onClick = vi.fn();
    render(() => <MissionRow {...baseProps} onClick={onClick} />);
    fireEvent.click(screen.getByText("My Mission"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("kebab opens a Rename + Delete menu", () => {
    const { container } = render(() => <MissionRow {...baseProps} />);
    const kebab = container.querySelector("button[class*='hover:text-foreground']")!;
    fireEvent.click(kebab);
    expect(screen.getByText("Rename")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
  });
});
