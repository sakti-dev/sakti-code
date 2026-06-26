import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { HybridVisionCard } from "../hybrid-vision-card";

const AUTO_ROUTE_RE = /Auto-route image prompts/;
const NO_VISION_RE = /no vision model is selected/;

describe("HybridVisionCard", () => {
  it("renders heading and description", () => {
    render(() => <HybridVisionCard enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Hybrid Vision Fallback")).toBeTruthy();
    expect(screen.getByText(AUTO_ROUTE_RE)).toBeTruthy();
  });

  it("renders a disabled vision model button", () => {
    render(() => <HybridVisionCard enabled={false} onToggle={vi.fn()} />);
    const btn = screen.getByText("Select vision model").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("checkbox is unchecked when disabled", () => {
    render(() => <HybridVisionCard enabled={false} onToggle={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("checkbox is checked when enabled", () => {
    render(() => <HybridVisionCard enabled={true} onToggle={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("calls onToggle with new value when checkbox is changed", () => {
    const onToggle = vi.fn();
    render(() => <HybridVisionCard enabled={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("shows fallback message when enabled", () => {
    render(() => <HybridVisionCard enabled={true} onToggle={vi.fn()} />);
    expect(screen.getByText(NO_VISION_RE)).toBeTruthy();
  });

  it("hides fallback message when disabled", () => {
    render(() => <HybridVisionCard enabled={false} onToggle={vi.fn()} />);
    expect(screen.queryByText(NO_VISION_RE)).toBeNull();
  });
});
