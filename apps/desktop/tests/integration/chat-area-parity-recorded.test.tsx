import { clearEventProcessingState } from "@/core/chat/domain/event-router-adapter";
import { useSessionTurns } from "@/core/chat/hooks";
import {
  useMessageStore,
  usePartStore,
  useSessionStore,
} from "@/core/state/providers/store-provider";
import { MessageTimeline } from "@/views/workspace-view/chat-area";
import type { EventOrderingFixture } from "@ekacode/shared";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
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

      return <MessageTimeline turns={useSessionTurns(sessionId)} isStreaming={() => false} />;
    }

    const dispose = render(
      () => (
        <TestProviders>
          <TestApp />
        </TestProviders>
      ),
      container
    );

    await applyFixture(fixture, extractStoreActions(storeContext!));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelector('[role="log"]')).toBeTruthy();
    expect(container.querySelectorAll('[role="listitem"]').length).toBeGreaterThan(0);
    expect(container.textContent).toContain("tell me about this project");

    dispose();
  });

  it("keeps stable timeline output when recorded fixture is replayed", async () => {
    const [sessionId] = createSignal<string | null>(fixture.sessionId);

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

      return <MessageTimeline turns={useSessionTurns(sessionId)} isStreaming={() => false} />;
    }

    const dispose = render(
      () => (
        <TestProviders>
          <TestApp />
        </TestProviders>
      ),
      container
    );

    const actions = extractStoreActions(storeContext!);

    await applyFixture(fixture, actions);
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
});
