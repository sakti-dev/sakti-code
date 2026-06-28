import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { Velomark } from "../velomark";

const mountedRoots: Array<() => void> = [];

const loadFixture = (name: string): string =>
  readFileSync(resolve(process.cwd(), "test/fixtures/streaming", name), "utf8");

const waitFor = async (
  predicate: () => boolean,
  attempts = 20
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

describe("Velomark streaming edge cases", () => {
  it("keeps rendering stable while a fenced code block is unfinished", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [markdown, setMarkdown] = createSignal(
      loadFixture("unfinished-fence.md")
    );

    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    expect(
      host.querySelector('[data-velomark-block-kind="code"]')
    ).not.toBeNull();
    expect(host.querySelector("pre > code")?.textContent).toContain(
      "const answer ="
    );

    setMarkdown([loadFixture("unfinished-fence.md"), "42;", "```"].join(""));
    await Promise.resolve();

    expect(host.querySelector("pre > code")?.textContent).toContain(
      "const answer =\n42;"
    );
  });

  it("keeps highlighted code rendering while streamed code grows", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [markdown, setMarkdown] = createSignal("```ts\nconst answer =");

    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    await waitFor(
      () =>
        (host.querySelectorAll("[data-velomark-code-highlighted] span")
          .length ?? 0) > 0,
      120
    );

    const blockBefore = host.querySelector('[data-velomark-block-kind="code"]');
    const codeBefore = host.querySelector(
      '[data-velomark-block-kind="code"] pre > code'
    );
    const highlightedBefore = host.querySelector(
      "[data-velomark-code-highlighted]"
    );
    expect(blockBefore).not.toBeNull();
    expect(codeBefore).not.toBeNull();
    expect(highlightedBefore).not.toBeNull();

    setMarkdown("```ts\nconst answer = 42;\n```");
    await waitFor(
      () =>
        (host.querySelectorAll("[data-velomark-code-highlighted] span")
          .length ?? 0) > 0 &&
        (
          host.querySelector('[data-velomark-block-kind="code"] pre > code')
            ?.textContent ?? ""
        ).includes("const answer = 42;"),
      120
    );

    const blockAfter = host.querySelector('[data-velomark-block-kind="code"]');
    const codeAfter = host.querySelector(
      '[data-velomark-block-kind="code"] pre > code'
    );
    const highlightedAfter = host.querySelector(
      "[data-velomark-code-highlighted]"
    );
    expect(blockAfter).toBe(blockBefore);
    expect(codeBefore).not.toBeNull();
    expect(codeAfter).not.toBeNull();
    expect(codeAfter).toBe(codeBefore);
    expect(highlightedAfter).toBe(highlightedBefore);
    expect(codeAfter?.textContent).toContain("const answer = 42;");
    expect(
      host.querySelectorAll("[data-velomark-code-highlighted] span").length
    ).toBeGreaterThan(0);
  });

  it("upgrades unresolved references when the definition arrives later", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [markdown, setMarkdown] = createSignal(
      loadFixture("unfinished-reference.md")
    );

    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("[docs][guide]");

    setMarkdown(
      `${loadFixture("unfinished-reference.md")}\n[guide]: https://example.com/docs\n`
    );
    await Promise.resolve();

    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/docs"
    );
    expect(host.querySelector("a")?.textContent).toBe("docs");
  });

  it("does not collapse the document while html is still incomplete", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [markdown, setMarkdown] = createSignal(
      loadFixture("unfinished-html.md")
    );

    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    expect(host.textContent).toContain("Text with");

    setMarkdown("Text with <span>hi</span>");
    await Promise.resolve();

    expect(host.querySelector("span")?.textContent).toBe("hi");
  });

  it("keeps rendering a document while a directive block is incomplete", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [markdown, setMarkdown] = createSignal(
      loadFixture("unfinished-directive.md")
    );

    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    expect(host.textContent).toContain("Alpha paragraph.");

    setMarkdown(`${loadFixture("unfinished-directive.md")}\n:::`);
    await Promise.resolve();

    expect(
      host.querySelector('[data-velomark-container="info"]')
    ).not.toBeNull();
  });

  it("keeps rendering while a table is incomplete and upgrades when it stabilizes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [markdown, setMarkdown] = createSignal(
      loadFixture("unfinished-table.md")
    );

    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    expect(host.textContent).toContain("Name");
    expect(host.textContent).toContain("Value");

    setMarkdown(
      ["| Name | Value |", "| --- | --- |", "| A | 1 |", "| B | 2 |"].join("\n")
    );
    await waitFor(() => host.querySelectorAll("table tbody tr").length === 2);

    expect(host.querySelectorAll("table tbody tr")).toHaveLength(2);
  });

  it("falls back safely while block math is still incomplete and upgrades when it stabilizes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [markdown, setMarkdown] = createSignal(["$$", "\\frac{1"].join("\n"));

    const dispose = render(() => <Velomark markdown={markdown()} />, host);
    mountedRoots.push(dispose);

    expect(
      host.querySelector('[data-velomark-block-kind="math"]')
    ).not.toBeNull();
    expect(
      host.querySelector('[data-velomark-block-kind="math"] pre > code')
        ?.textContent
    ).toContain("\\frac{1");

    setMarkdown(["$$", "\\frac{1}{2}", "$$"].join("\n"));
    await waitFor(
      () =>
        host.querySelector(
          '[data-velomark-block-kind="math"] .katex-display'
        ) !== null
    );

    expect(
      host.querySelector('[data-velomark-block-kind="math"] .katex-display')
    ).not.toBeNull();
    expect(
      host.querySelector('[data-velomark-block-kind="math"] pre > code')
    ).toBeNull();
  });
});
