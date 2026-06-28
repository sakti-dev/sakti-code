import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import App from "../app";

describe("playground preset controls", () => {
  it("loads the single incremark example preset into the renderer", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);

    expect(container.textContent).toContain("🚀 Incremark SolidJS Example");
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("Incremark Example")
      )
    ).toBe(false);

    dispose();
    container.remove();
  });

  it("does not render the freeform markdown textarea anymore", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);

    expect(container.querySelector("textarea")).toBeNull();

    dispose();
    container.remove();
  });
});
