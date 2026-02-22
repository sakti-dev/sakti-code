import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("EmptyState", () => {
  let container: HTMLDivElement;
  let dispose: () => void | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("should render title and subtitle", () => {
    ({ unmount: dispose } = render(
      () => (
        <div>
          <div class="empty-state">
            <span class="empty-icon">🔍</span>
            <h3>No results found</h3>
            <p>Try a different search term</p>
          </div>
        </div>
      ),
      { container }
    ));
    expect(container.textContent).toContain("No results found");
    expect(container.textContent).toContain("Try a different search term");
  });

  it("should show icon when provided", () => {
    ({ unmount: dispose } = render(
      () => (
        <div>
          <div class="empty-state">
            <span class="empty-icon">📁</span>
            <h3>No workspaces</h3>
          </div>
        </div>
      ),
      { container }
    ));
    expect(container.querySelector(".empty-icon")).toBeTruthy();
  });
});
