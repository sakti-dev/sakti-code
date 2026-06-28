import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { Velomark } from "../velomark";

const mountedRoots: Array<() => void> = [];

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()?.();
  }
  document.body.innerHTML = "";
});

describe("Velomark DOM identity", () => {
  it("keeps the earlier block element when a later paragraph is appended", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const [markdown, setMarkdown] = createSignal("First paragraph");
    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    const firstBlockBefore = host.querySelector(
      '[data-velomark-block-index="0"]'
    );
    expect(firstBlockBefore?.textContent).toBe("First paragraph");

    setMarkdown("First paragraph\n\nSecond paragraph");
    await Promise.resolve();

    const firstBlockAfter = host.querySelector(
      '[data-velomark-block-index="0"]'
    );
    const secondBlock = host.querySelector('[data-velomark-block-index="1"]');

    expect(firstBlockAfter).toBe(firstBlockBefore);
    expect(secondBlock?.textContent).toBe("Second paragraph");
  });

  it("keeps the earlier block text node when a later paragraph is appended", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const [markdown, setMarkdown] = createSignal("Alpha");
    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    const firstBlockBefore = host.querySelector(
      '[data-velomark-block-index="0"]'
    );
    const firstTextNodeBefore = firstBlockBefore?.firstChild;
    expect(firstTextNodeBefore?.textContent).toBe("Alpha");

    setMarkdown("Alpha\n\nBeta");
    await Promise.resolve();

    const firstBlockAfter = host.querySelector(
      '[data-velomark-block-index="0"]'
    );
    const firstTextNodeAfter = firstBlockAfter?.firstChild;

    expect(firstBlockAfter).toBe(firstBlockBefore);
    expect(firstTextNodeAfter).toBe(firstTextNodeBefore);
  });
});
