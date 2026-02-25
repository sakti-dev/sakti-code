import { TopToolbar } from "@/components/top-toolbar/top-toolbar";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("TopToolbar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders homepage mode without home button", () => {
    const { container } = render(() => <TopToolbar view="homepage" />);

    expect(container.textContent).toContain("Homepage");
    expect(container.querySelector('button[aria-label="Go home"]')).toBeNull();
  });

  it("renders task-session mode with home button", () => {
    const onGoHome = vi.fn();
    const { container } = render(() => (
      <TopToolbar view="task-session" title="Build workflow" onGoHome={onGoHome} />
    ));

    const home = container.querySelector('button[aria-label="Go home"]') as HTMLButtonElement;
    expect(home).not.toBeNull();
    expect(container.textContent).toContain("Build workflow");

    home.click();
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });
});
