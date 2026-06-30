import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import { EmptyState } from "../home/empty-state.tsx";

describe("EmptyState", () => {
  it("renders title", () => {
    const { getByText } = render(() => <EmptyState title="No projects yet" />);
    expect(getByText("No projects yet")).toBeTruthy();
  });

  it("renders icon when provided", () => {
    const { getByText } = render(() => <EmptyState icon="📂" title="No projects yet" />);
    expect(getByText("📂")).toBeTruthy();
  });

  it("renders subtitle when provided", () => {
    const { getByText } = render(() => (
      <EmptyState subtitle="Open a folder" title="No projects yet" />
    ));
    expect(getByText("Open a folder")).toBeTruthy();
  });

  it("hides subtitle when not provided", () => {
    const { queryByText } = render(() => <EmptyState title="No projects yet" />);
    expect(queryByText("Open a folder")).toBeNull();
  });
});
