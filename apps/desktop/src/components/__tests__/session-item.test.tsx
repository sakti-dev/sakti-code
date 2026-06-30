import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { SessionItem } from "../layout/sidebar/session-item.tsx";

const agoRegex = /ago/;

describe("SessionItem", () => {
  it("renders session title", () => {
    render(() => (
      <SessionItem
        isActive={false}
        onClick={vi.fn()}
        sessionId="s1"
        title="Test Session"
        updatedAt={Date.now()}
      />
    ));
    expect(screen.getByText("Test Session")).toBeTruthy();
  });

  it("renders relative time", () => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    render(() => (
      <SessionItem
        isActive={false}
        onClick={vi.fn()}
        sessionId="s1"
        title="Test"
        updatedAt={fiveMinAgo}
      />
    ));
    expect(screen.getByText(agoRegex)).toBeTruthy();
  });

  it("applies active styles when isActive", () => {
    const { container } = render(() => (
      <SessionItem
        isActive={true}
        onClick={vi.fn()}
        sessionId="s1"
        title="Test"
        updatedAt={Date.now()}
      />
    ));
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("border-l-primary");
  });

  it("calls onClick with sessionId", async () => {
    const onClick = vi.fn();
    render(() => (
      <SessionItem
        isActive={false}
        onClick={onClick}
        sessionId="s1"
        title="Test"
        updatedAt={Date.now()}
      />
    ));
    screen.getByText("Test").click();
    expect(onClick).toHaveBeenCalledWith("s1");
  });

  it("renders 'Untitled session' when title is null", () => {
    render(() => (
      <SessionItem
        isActive={false}
        onClick={vi.fn()}
        sessionId="s1"
        title={null}
        updatedAt={Date.now()}
      />
    ));
    expect(screen.getByText("Untitled session")).toBeTruthy();
  });
});
