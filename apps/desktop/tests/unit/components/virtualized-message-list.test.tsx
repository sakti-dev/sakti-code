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
      <div data-testid="mock-virtual-message-list">
        {props.each.map((item, index) => props.children(item, () => index))}
      </div>
    );
  },
}));

import { VirtualizedMessageList } from "@ekacode/desktop/components/virtualized-message-list";
import type { ChatMessage } from "@ekacode/desktop/presentation/hooks";

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

function makeMessages(): ChatMessage[] {
  return [
    {
      id: "m1",
      role: "user",
      parts: [],
      createdAt: 1,
      sessionId: "s1",
    },
    {
      id: "m2",
      role: "assistant",
      parts: [],
      createdAt: 2,
      sessionId: "s1",
    },
  ];
}

describe("VirtualizedMessageList", () => {
  it("renders messages through renderMessage", () => {
    const [messages] = createSignal<ChatMessage[]>(makeMessages());
    const app = mount(() => (
      <VirtualizedMessageList
        messages={messages}
        renderMessage={message => <div>{message.id}</div>}
      />
    ));

    expect(app.container.textContent).toContain("m1");
    expect(app.container.textContent).toContain("m2");
    app.dispose();
  });

  it("passes virtualization config to VirtualList", () => {
    const [messages] = createSignal<ChatMessage[]>(makeMessages());
    const app = mount(() => (
      <VirtualizedMessageList
        messages={messages}
        renderMessage={message => <div>{message.id}</div>}
        itemSize={72}
        containerHeight={420}
        overscan={9}
      />
    ));

    expect(capturedVirtualListProps?.rowHeight).toBe(72);
    expect(capturedVirtualListProps?.rootHeight).toBe(420);
    expect(capturedVirtualListProps?.overscanCount).toBe(9);
    app.dispose();
  });
});
