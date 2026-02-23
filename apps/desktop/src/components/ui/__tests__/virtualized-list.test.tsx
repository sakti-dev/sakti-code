import { render } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import { VirtualizedList } from "@/components/ui/virtualized-list";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { unmount: dispose } = render(ui, { container });
  return {
    container,
    dispose: () => {
      dispose();
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("VirtualizedList", () => {
  it("renders list items through the virtualization adapter", () => {
    const [items] = createSignal(["one", "two", "three"]);
    const app = mount(() => (
      <VirtualizedList items={items} itemSize={24} containerHeight={240}>
        {(item, index) => <div>{`${index()}:${String(item)}`}</div>}
      </VirtualizedList>
    ));

    expect(app.container.textContent).toContain("0:one");
    expect(app.container.textContent).toContain("1:two");
    expect(app.container.textContent).toContain("2:three");
    app.dispose();
  });

  it("renders only the visible window plus overscan", () => {
    const [items] = createSignal(Array.from({ length: 50 }, (_, i) => i));
    const app = mount(() => (
      <VirtualizedList items={items} itemSize={20} containerHeight={100} overscan={1}>
        {item => <div>{String(item)}</div>}
      </VirtualizedList>
    ));

    const renderedRows = app.container.querySelectorAll(
      '[data-component="virtualized-list"] > div > div'
    );
    expect(renderedRows.length).toBeLessThan(50);
    app.dispose();
  });
});
