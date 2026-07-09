import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { InlineContextList } from "../inline-context-list";
import type { Row } from "../context-rows";

const rows: Row[] = [
  {
    group: "Commands",
    id: "cmd:commit",
    label: "commit",
    token: "/commit",
    description: "commit and push",
  },
  { group: "Skills", id: "skl:graphify", label: "graphify", token: "skill:graphify" },
  { group: "Files", id: "file:src/a.ts", label: "src/a.ts", token: "@src/a.ts" },
];

afterEach(cleanup);

describe("InlineContextList", () => {
  it("renders group headings and rows in order", () => {
    render(() => <InlineContextList mode="/" rows={rows} activeId="cmd:commit" onPick={vi.fn()} />);
    expect(screen.getByText("Commands")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.getByText("commit")).toBeTruthy();
    expect(screen.getByText("graphify")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("marks the active row aria-selected", () => {
    render(() => (
      <InlineContextList mode="/" rows={rows} activeId="skl:graphify" onPick={vi.fn()} />
    ));
    const active = screen.getByText("graphify").closest('button, [role="option"]')!;
    expect(active.getAttribute("aria-selected")).toBe("true");
    const idle = screen.getByText("commit").closest('button, [role="option"]')!;
    expect(idle.getAttribute("aria-selected")).toBe("false");
  });

  it("calls onPick with the token when a row is clicked", () => {
    const onPick = vi.fn();
    render(() => <InlineContextList mode="@" rows={rows} activeId={null} onPick={onPick} />);
    fireEvent.click(screen.getByText("src/a.ts"));
    expect(onPick).toHaveBeenCalledWith("@src/a.ts");
  });

  it("does not render group headings in @ mode", () => {
    render(() => <InlineContextList mode="@" rows={rows} activeId={null} onPick={vi.fn()} />);
    expect(screen.queryByText("Commands")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
    expect(screen.queryByText("Files")).toBeNull();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("shows an empty state when there are no rows", () => {
    render(() => <InlineContextList mode="/" rows={[]} activeId={null} onPick={vi.fn()} />);
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("scrolls the active row into view when activeId is set", () => {
    const spy = vi.fn();
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      render(() => (
        <InlineContextList mode="/" rows={rows} activeId="file:src/a.ts" onPick={vi.fn()} />
      ));
      expect(spy).toHaveBeenCalled();
    } finally {
      // jsdom does not implement scrollIntoView; restore that (typeof guard in
      // the component then skips it for other tests).
      HTMLElement.prototype.scrollIntoView = undefined as never;
    }
  });
});
