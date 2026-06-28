import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import App from "../app";

function getMetricValue(container: HTMLElement, label: string): string | null {
  const terms = Array.from(container.querySelectorAll("dt"));
  const term = terms.find((entry) => entry.textContent?.includes(label));
  const definition = term?.parentElement?.querySelector("dd");
  return definition?.textContent?.trim() ?? null;
}

describe("playground diagnostics strip", () => {
  it("shows live block metrics from renderer updates", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);

    expect(container.textContent).toContain("Diagnostics");
    expect(container.textContent).toContain("Total Blocks");
    expect(container.textContent).toContain("Reused");
    expect(Number(getMetricValue(container, "Total Blocks"))).toBeGreaterThan(
      0
    );
    expect(Number(getMetricValue(container, "Reused"))).toBeGreaterThanOrEqual(
      0
    );
    expect(Number(getMetricValue(container, "Replaced"))).toBe(0);
    expect(
      Number(getMetricValue(container, "Appended"))
    ).toBeGreaterThanOrEqual(0);

    dispose();
    container.remove();
  });
});
