import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { Velomark } from "../src";

const mountedRoots: Array<() => void> = [];

const loadParityFixture = (fileName: string): string =>
  readFileSync(
    resolve(process.cwd(), "test/fixtures/parity", fileName),
    "utf8"
  );

const waitFor = async (
  predicate: () => boolean,
  attempts = 200
): Promise<void> => {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  throw new Error("Condition was not met before waitFor timed out.");
};

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()?.();
  }
  document.body.innerHTML = "";
});

describe("velomark render-surface parity harness", () => {
  it("renders inline math fixtures with KaTeX output", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={loadParityFixture("math-inline.md")} />,
      host
    );
    mountedRoots.push(dispose);

    const inlineMath = host.querySelector("[data-velomark-inline-math]");
    expect(inlineMath).not.toBeNull();

    await waitFor(() => inlineMath?.querySelector(".katex") !== null);

    expect(inlineMath?.querySelector(".katex")).not.toBeNull();
    expect(inlineMath?.querySelector("code")).toBeNull();
  });

  it("renders block math fixtures with KaTeX output", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={loadParityFixture("math-block.md")} />,
      host
    );
    mountedRoots.push(dispose);

    const mathBlock = host.querySelector('[data-velomark-block-kind="math"]');
    expect(mathBlock).not.toBeNull();
    await waitFor(() => mathBlock?.querySelector(".katex-display") !== null);
    expect(mathBlock?.querySelector(".katex-display")).not.toBeNull();
    expect(mathBlock?.querySelector("pre > code")).toBeNull();
  });

  it("renders nested inline html elements semantically", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={loadParityFixture("html-inline-nested.md")} />,
      host
    );
    mountedRoots.push(dispose);

    const chip = host.querySelector("span.chip");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-tone")).toBe("info");
    expect(chip?.querySelector("strong")?.textContent).toBe("hot");
    expect(chip?.textContent).toContain("path with");
    expect(host.querySelector("[data-velomark-inline-html]")).toBeNull();
  });

  it("renders nested block html elements semantically", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={loadParityFixture("html-block-nested.md")} />,
      host
    );
    mountedRoots.push(dispose);

    const section = host.querySelector("section.note");
    expect(section).not.toBeNull();
    expect(section?.querySelector("p strong")?.textContent).toBe("content");
    expect(section?.querySelector("p a")?.getAttribute("href")).toBe(
      "https://example.com"
    );
    expect(section?.querySelectorAll("ul > li")).toHaveLength(2);

    await waitFor(() => section?.querySelector(".katex") !== null);
    expect(section?.querySelector(".katex")).not.toBeNull();
  });

  it("renders container and leaf directives with child content intact", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={loadParityFixture("directive-container.md")} />,
      host
    );
    mountedRoots.push(dispose);

    const container = host.querySelector('[data-velomark-container="info"]');
    expect(container).not.toBeNull();
    expect(container?.getAttribute("data-velomark-attr-title")).toBe(
      "Information"
    );
    expect(container?.getAttribute("data-velomark-attr-tone")).toBe("info");
    expect(container?.getAttribute("data-velomark-attr-emphasis")).toBe("high");
    expect(container?.querySelector("p")?.textContent).toBe("Alpha paragraph.");
    expect(container?.querySelectorAll("ul > li")).toHaveLength(2);

    const leaf = container?.querySelector(
      '[data-velomark-leaf-directive="callout"]'
    );
    expect(leaf).not.toBeNull();
    expect(leaf?.getAttribute("data-velomark-attr-title")).toBe("Heads up");
    expect(leaf?.getAttribute("data-velomark-attr-tone")).toBe("warn");
  });

  it("renders inline directives without dropping surrounding phrasing content", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => <Velomark markdown={loadParityFixture("directive-inline.md")} />,
      host
    );
    mountedRoots.push(dispose);

    const badge = host.querySelector('[data-velomark-text-directive="badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-velomark-attr-tone")).toBe("info");
    expect(badge?.getAttribute("data-velomark-attr-icon")).toBe("bolt");
    expect(badge?.getAttribute("data-velomark-attr-emphasis")).toBe("high");
    expect(badge?.textContent).toBe("Beta");
    expect(host.querySelector("strong")?.textContent).toBe("signal");
  });

  it("keeps final highlighted code intact for the streaming code growth fixture", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const finalFixture = loadParityFixture("streaming-code-growth.md");
    const [markdown, setMarkdown] = createSignal(
      [
        "```ts",
        'import { createSignal } from "solid-js";',
        "",
        'type Status = "idle" | "streaming" | "done";',
      ].join("\n")
    );

    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    setMarkdown(finalFixture);
    await waitFor(
      () =>
        (host.querySelectorAll("[data-velomark-code-highlighted] span")
          .length ?? 0) > 0 &&
        (host.querySelector("pre > code")?.textContent ?? "").includes(
          "createSessionLabel"
        )
    );

    expect(host.querySelector("pre > code")?.textContent).toContain(
      "createSessionLabel"
    );
    expect(
      host.querySelectorAll("[data-velomark-code-highlighted] span").length
    ).toBeGreaterThan(0);
  });
});
