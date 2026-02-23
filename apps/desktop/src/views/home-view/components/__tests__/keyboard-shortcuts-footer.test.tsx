import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("KeyboardShortcutsFooter", () => {
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

  it("should render keyboard shortcuts text", () => {
    ({ unmount: dispose } = render(
      () => (
        <div class="keyboard-shortcuts-footer">
          <span>⌘1-9 to open workspaces • ⌘K to search • ⌘N for new workspace</span>
        </div>
      ),
      { container }
    ));
    expect(container.textContent).toContain("⌘1-9");
    expect(container.textContent).toContain("⌘K");
    expect(container.textContent).toContain("⌘N");
  });
});
