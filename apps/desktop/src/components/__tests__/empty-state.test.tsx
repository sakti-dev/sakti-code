import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import { EmptyState } from "../home/empty-state.tsx";

describe("EmptyState", () => {
  it("renders title", () => {
    render(() => <EmptyState title="No projects yet" />);
    expect(screen.getByText("No projects yet")).toBeTruthy();
  });

  it("renders icon when provided", () => {
    render(() => <EmptyState icon="📂" title="No projects yet" />);
    expect(screen.getByText("📂")).toBeTruthy();
  });

  it("renders subtitle when provided", () => {
    render(() => <EmptyState subtitle="Open a folder" title="No projects yet" />);
    expect(screen.getByText("Open a folder")).toBeTruthy();
  });

  it("hides subtitle when not provided", () => {
    render(() => <EmptyState title="No projects yet" />);
    expect(screen.queryByText("Open a folder")).toBeNull();
  });
});
