import { clearEventProcessingState } from "@/core/chat/domain/event-router-adapter";
import { useSessionTurns } from "@/core/chat/hooks";
import {
  useMessageStore,
  usePartStore,
  useSessionStore,
} from "@/core/state/providers/store-provider";
import { MessageTimeline } from "@/views/workspace-view/chat-area/timeline/message-timeline";
import type { EventOrderingFixture } from "@sakti-code/shared";
import { render } from "@solidjs/testing-library";
import { Show, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import recordedFixtures from "../fixtures/recorded/event-ordering.from-log.json";
import { applyFixture, extractStoreActions } from "../helpers/fixture-loader";
import { TestProviders } from "../helpers/test-providers";

const fixture = (recordedFixtures as EventOrderingFixture[])[0];

describe("Integration: Chat Area Parity (Recorded Fixture)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    clearEventProcessingState();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    clearEventProcessingState();
    container.remove();
  });

  it("renders turn timeline from recorded fixture events", async () => {
    const [sessionId] = createSignal<string | null>(fixture.sessionId);
    const [ready, setReady] = createSignal(false);

    let storeContext: {
      message: [unknown, ReturnType<typeof useMessageStore>[1]];
      part: [unknown, ReturnType<typeof usePartStore>[1]];
      session: [unknown, ReturnType<typeof useSessionStore>[1]];
    };

    function TestApp() {
      storeContext = {
        message: useMessageStore(),
        part: usePartStore(),
        session: useSessionStore(),
      };

      return (
        <Show when={ready()}>
          <MessageTimeline turns={useSessionTurns(sessionId)} isStreaming={() => false} />
        </Show>
      );
    }

    const { unmount: dispose } = render(
      () => (
        <TestProviders>
          <TestApp />
        </TestProviders>
      ),
      { container }
    );

    await applyFixture(fixture, extractStoreActions(storeContext!));
    setReady(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelector('[role="log"]')).toBeTruthy();
    const turnCount = container.querySelectorAll('[role="listitem"]').length;
    const hasFallback = container.textContent?.includes("No messages yet. Start a conversation!");
    expect(turnCount > 0 || hasFallback).toBe(true);
    expect((container.textContent || "").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("Show steps");
    expect(container.textContent).not.toContain("Hide steps");
    expect(container.textContent).not.toContain("Working");

    dispose();
  });

  it("keeps stable timeline output when recorded fixture is replayed", async () => {
    const [sessionId] = createSignal<string | null>(fixture.sessionId);
    const [ready, setReady] = createSignal(false);

    let storeContext: {
      message: [unknown, ReturnType<typeof useMessageStore>[1]];
      part: [unknown, ReturnType<typeof usePartStore>[1]];
      session: [unknown, ReturnType<typeof useSessionStore>[1]];
    };

    function TestApp() {
      storeContext = {
        message: useMessageStore(),
        part: usePartStore(),
        session: useSessionStore(),
      };

      return (
        <Show when={ready()}>
          <MessageTimeline turns={useSessionTurns(sessionId)} isStreaming={() => false} />
        </Show>
      );
    }

    const { unmount: dispose } = render(
      () => (
        <TestProviders>
          <TestApp />
        </TestProviders>
      ),
      { container }
    );

    const actions = extractStoreActions(storeContext!);

    await applyFixture(fixture, actions);
    setReady(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const firstCount = container.querySelectorAll('[role="listitem"]').length;

    await applyFixture(fixture, actions);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const secondCount = container.querySelectorAll('[role="listitem"]').length;

    expect(secondCount).toBe(firstCount);

    dispose();
  });

  it("remains scroll-interactive under high-volume fixture replay", async () => {
    const [sessionId] = createSignal<string | null>(fixture.sessionId);
    const [ready, setReady] = createSignal(false);

    let storeContext: {
      message: [unknown, ReturnType<typeof useMessageStore>[1]];
      part: [unknown, ReturnType<typeof usePartStore>[1]];
      session: [unknown, ReturnType<typeof useSessionStore>[1]];
    };

    function TestApp() {
      storeContext = {
        message: useMessageStore(),
        part: usePartStore(),
        session: useSessionStore(),
      };

      return (
        <Show when={ready()}>
          <MessageTimeline turns={useSessionTurns(sessionId)} isStreaming={() => true} />
        </Show>
      );
    }

    const { unmount: dispose } = render(
      () => (
        <TestProviders>
          <TestApp />
        </TestProviders>
      ),
      { container }
    );

    const actions = extractStoreActions(storeContext!);

    for (let i = 0; i < 4; i++) {
      await applyFixture(fixture, actions);
    }
    setReady(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const log = container.querySelector('[role="log"]') as HTMLDivElement | null;
    expect(log).toBeTruthy();
    if (!log) {
      dispose();
      return;
    }

    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 4000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 500 });

    log.scrollTop = 1800;
    log.dispatchEvent(new Event("scroll"));

    await applyFixture(fixture, actions);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    log.scrollTop = 1200;
    log.dispatchEvent(new Event("scroll"));

    expect(log.className).toContain("overflow-y-auto");
    expect(typeof log.scrollTop).toBe("number");
    expect(log.scrollTop).toBeGreaterThan(0);

    dispose();
  });
});
