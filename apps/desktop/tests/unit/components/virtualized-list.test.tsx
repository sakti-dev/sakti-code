import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

let capturedVirtualListProps: Record<string, unknown> | null = null;

vi.mock("@solid-primitives/virtual", () => ({
  VirtualList: (
    props: {
      each: unknown[];
      children: (item: unknown, index: () => number) => unknown;
    } & Record<string, unknown>
  ) => {
    capturedVirtualListProps = props;
    return (
      <div data-testid="mock-virtual-list">
        {props.each.map((item, index) => props.children(item, () => index))}
      </div>
    );
  },
}));

import { VirtualizedList } from "@ekacode/desktop/components/virtualized-list";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return {
    container,
    dispose: () => {
      dispose();
      container.remove();
    },
  };
}

afterEach(() => {
  capturedVirtualListProps = null;
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

  it("passes sizing and overscan config to VirtualList", () => {
    const [items] = createSignal([1, 2, 3]);
    const app = mount(() => (
      <VirtualizedList items={items} itemSize={48} containerHeight={600} overscan={7}>
        {item => <div>{String(item)}</div>}
      </VirtualizedList>
    ));

    expect(capturedVirtualListProps?.rowHeight).toBe(48);
    expect(capturedVirtualListProps?.rootHeight).toBe(600);
    expect(capturedVirtualListProps?.overscanCount).toBe(7);
    app.dispose();
  });
});
