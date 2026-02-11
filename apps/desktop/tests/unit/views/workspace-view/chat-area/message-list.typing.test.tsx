import { MessageList } from "@ekacode/desktop/views/workspace-view/chat-area/message-list";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock VirtualList to avoid JSX extension issues
vi.mock("@solid-primitives/virtual", () => ({
  VirtualList: (props: { each: string[]; children: (id: string) => unknown }) => {
    return <div data-testid="virtual-list">{props.each.map(id => props.children(id))}</div>;
  },
}));

// Mock the dependencies
vi.mock("@renderer/presentation/hooks/use-messages", () => ({
  useMessages: vi.fn(() => ({
    list: vi.fn(() => []),
    userMessages: vi.fn(() => []),
    get: vi.fn(() => undefined),
  })),
}));

vi.mock("@renderer/hooks/create-auto-scroll", () => ({
  createAutoScroll: vi.fn(() => ({
    scrollRef: vi.fn(),
    handleScroll: vi.fn(),
    isAutoScrolling: vi.fn(() => true),
    setAutoScrolling: vi.fn(),
    scrollToBottom: vi.fn(),
  })),
}));

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
  document.body.innerHTML = "";
});

describe("MessageList content-priority typing", () => {
  it("should show typing indicator when generating and no content exists", () => {
    const app = mount(() => (
      <MessageList sessionId="test-session" isGenerating={true} thinkingContent="" />
    ));

    // Typing indicator should be visible
    const typingDots = app.container.querySelectorAll(
      '[data-testid="message-list-typing-indicator"] .typing-dot'
    );
    expect(typingDots.length).toBe(3);

    app.dispose();
  });

  it("should hide typing indicator when thinking content exists", async () => {
    const app = mount(() => (
      <MessageList
        sessionId="test-session"
        isGenerating={true}
        thinkingContent="Let me think about this..."
      />
    ));

    // Wait for SolidJS to finish rendering
    await new Promise(resolve => setTimeout(resolve, 10));

    // Typing indicator should NOT be visible when thinking content exists.
    const typingDots = app.container.querySelectorAll(
      '[data-testid="message-list-typing-indicator"] .typing-dot'
    );
    expect(typingDots.length).toBe(0);
    expect(
      app.container.querySelector('[data-testid="message-list-thinking-bubble"]')
    ).toBeTruthy();

    app.dispose();
  });

  it("should not show typing indicator when not generating", () => {
    const app = mount(() => (
      <MessageList sessionId="test-session" isGenerating={false} thinkingContent="" />
    ));

    // Typing indicator should not be visible
    const typingDots = app.container.querySelectorAll(
      '[data-testid="message-list-typing-indicator"] .typing-dot'
    );
    expect(typingDots.length).toBe(0);

    app.dispose();
  });
});

describe("MessageList typing indicator requirements", () => {
  it("should have typing indicator with fade-in animation class", () => {
    const app = mount(() => (
      <MessageList sessionId="test-session" isGenerating={true} thinkingContent="" />
    ));

    // Find the typing indicator container
    const typingContainers = app.container.querySelectorAll(".animate-fade-in-up");
    expect(typingContainers.length).toBeGreaterThan(0);

    app.dispose();
  });

  it("should have three typing dots", () => {
    const app = mount(() => (
      <MessageList sessionId="test-session" isGenerating={true} thinkingContent="" />
    ));

    const typingDots = app.container.querySelectorAll(
      '[data-testid="message-list-typing-indicator"] .typing-dot'
    );
    expect(typingDots.length).toBe(3);

    app.dispose();
  });
});
