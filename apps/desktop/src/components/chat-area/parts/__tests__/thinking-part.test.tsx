import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { MessagePart } from "~/stores/types.ts";
import type { PartProps } from "../part-registry.ts";
import { ThinkingPart } from "../thinking-part.tsx";

const thoughtForRegex = /Thought for \d+s/;

function renderThinking(part: MessagePart, isStreaming = false) {
  const props: PartProps = { isStreaming, part };
  return render(() => <ThinkingPart {...props} />);
}

describe("ThinkingPart", () => {
  it("shows 'Thinking...' while streaming with no endedAt", () => {
    const { getByText } = renderThinking(
      { type: "thinking", text: "Let me think...", startedAt: Date.now() },
      true
    );
    expect(getByText("Thinking...")).toBeTruthy();
  });

  it("shows 'Thought for Xs' when endedAt is set with startedAt", () => {
    const startedAt = Date.now() - 5000;
    const endedAt = Date.now();
    const { getByText } = renderThinking({
      type: "thinking",
      text: "Hmm",
      startedAt,
      endedAt,
    });
    expect(getByText(thoughtForRegex)).toBeTruthy();
  });

  it("shows 'Thought' with no timing info when hydrated", () => {
    const { getByText } = renderThinking({
      type: "thinking",
      text: "Hmm",
    });
    expect(getByText("Thought")).toBeTruthy();
  });

  it("does not render when thinking text is empty", () => {
    const { container } = renderThinking({
      type: "thinking",
      text: "   ",
    });
    expect(
      container.querySelector("[data-component='thinking-part']")
    ).toBeNull();
  });

  it("toggles content visibility on header click", () => {
    const startedAt = Date.now() - 3000;
    const endedAt = Date.now();
    const { container } = renderThinking({
      type: "thinking",
      text: "Deep thoughts here",
      startedAt,
      endedAt,
    });

    const header = container.querySelector(
      "[data-slot='thinking-header']"
    ) as HTMLElement;
    expect(header).toBeTruthy();

    const content = container.querySelector(
      "[data-slot='thinking-content']"
    ) as HTMLElement | null;
    expect(content).not.toBeNull();
    expect(content!.style.getPropertyValue("grid-template-rows")).toBe("0fr");

    header.click();

    const contentAfter = container.querySelector(
      "[data-slot='thinking-content']"
    ) as HTMLElement | null;
    expect(contentAfter!.style.getPropertyValue("grid-template-rows")).toBe(
      "1fr"
    );

    header.click();

    const contentFinal = container.querySelector(
      "[data-slot='thinking-content']"
    ) as HTMLElement | null;
    expect(contentFinal!.style.getPropertyValue("grid-template-rows")).toBe(
      "0fr"
    );
  });

  it("auto-expands while streaming", () => {
    const { container } = renderThinking(
      { type: "thinking", text: "Thinking...", startedAt: Date.now() },
      true
    );

    const content = container.querySelector(
      "[data-slot='thinking-content']"
    ) as HTMLElement | null;
    expect(content).not.toBeNull();
    expect(content!.style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("starts collapsed when hydrated (no timing)", () => {
    const { container } = renderThinking({
      type: "thinking",
      text: "Old thinking",
    });

    const content = container.querySelector(
      "[data-slot='thinking-content']"
    ) as HTMLElement | null;
    expect(content).not.toBeNull();
    expect(content!.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });
});
