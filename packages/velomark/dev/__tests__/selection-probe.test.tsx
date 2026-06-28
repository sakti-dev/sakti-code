import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import App from "../app";

describe("playground selection probe", () => {
  it("disables the selection probe in normal non-debug mode", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);
    const probeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Probe selection")
    ) as HTMLButtonElement;

    expect(probeButton).toBeTruthy();
    expect(probeButton.disabled).toBe(true);
    expect(container.textContent).toContain("Selection probe unavailable");

    dispose();
    container.remove();
  });
});
