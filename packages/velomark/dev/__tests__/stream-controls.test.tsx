import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../app";

function getNumericInputByLabel(
  container: HTMLElement,
  label: string
): HTMLInputElement | null {
  const labels = Array.from(container.querySelectorAll("label"));
  const entry = labels.find((node) => node.textContent?.includes(label));
  return entry?.querySelector("input") ?? null;
}

describe("playground stream controls", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams renderer content progressively when simulate stream is clicked", async () => {
    vi.useFakeTimers();

    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);
    const chunkSizeInput = getNumericInputByLabel(container, "Chunk Size");
    const intervalInput = getNumericInputByLabel(container, "Interval");
    expect(chunkSizeInput).toBeTruthy();
    expect(intervalInput).toBeTruthy();

    if (!(chunkSizeInput && intervalInput)) {
      throw new Error("Missing stream control inputs.");
    }

    chunkSizeInput.value = "256";
    chunkSizeInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    intervalInput.value = "1";
    intervalInput.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const simulateButton = Array.from(
      container.querySelectorAll("button")
    ).find((button) =>
      button.textContent?.includes("Simulate stream")
    ) as HTMLButtonElement;
    expect(simulateButton).toBeTruthy();

    simulateButton.click();

    await vi.advanceTimersByTimeAsync(1);
    expect(container.textContent).toContain("🚀");
    expect(container.textContent).not.toContain("Flowchart");

    await vi.advanceTimersByTimeAsync(100);
    expect(container.textContent).toContain("Incremark SolidJS Example");
    expect(container.textContent).toContain("Flowchart");

    dispose();
    container.remove();
  }, 10_000);
});
