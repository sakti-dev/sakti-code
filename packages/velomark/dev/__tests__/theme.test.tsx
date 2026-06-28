import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { darkTheme, defaultTheme } from "../../src/theme/tokens";
import App from "../app";
import { PLAYGROUND_THEME_STORAGE_KEY } from "../hooks/use-playground-theme";

const DEV_ENTRY_PATH = resolve(import.meta.dirname, "../index.tsx");
const DEV_MAIN_CSS_PATH = resolve(import.meta.dirname, "../main.css");

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.removeItem(PLAYGROUND_THEME_STORAGE_KEY);
  document.body.innerHTML = "";
});

describe("playground theme contract", () => {
  it("loads the desktop token and markdown styles from the dev entry", () => {
    const entrySource = readFileSync(DEV_ENTRY_PATH, "utf8");
    const mainCssSource = readFileSync(DEV_MAIN_CSS_PATH, "utf8");

    expect(entrySource).toContain("./main.css");
    expect(mainCssSource).toContain('@import "tailwindcss";');
    expect(mainCssSource).toContain(
      "../../../apps/desktop/src/assets/styles/tokens.css"
    );
    expect(mainCssSource).toContain(
      "../../../apps/desktop/src/assets/styles/markdown.css"
    );
    expect(mainCssSource).toContain("../src/theme/styles.css");
  });

  it("keeps the desktop markdown scope around the rendered preview", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);

    const markdownRoot = container.querySelector(
      '.renderer-surface .markdown-content[data-component="markdown"]'
    );

    expect(markdownRoot).not.toBeNull();

    dispose();
    container.remove();
  });

  it("defaults the playground to desktop dark mode", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(PLAYGROUND_THEME_STORAGE_KEY)).toBe("dark");
    expect(
      (
        container.querySelector("[data-velomark-root]") as HTMLDivElement | null
      )?.style.getPropertyValue("--velomark-color-surface-code")
    ).toBe(darkTheme.color.surface.code);

    dispose();
    container.remove();
  });

  it("lets the user switch between light and dark mode with persisted state", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const dispose = render(() => <App />, container);

    const lightButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Light"
    );
    const darkButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Dark"
    );

    expect(lightButton).toBeDefined();
    expect(darkButton).toBeDefined();

    lightButton?.click();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(PLAYGROUND_THEME_STORAGE_KEY)).toBe("light");
    expect(
      (
        container.querySelector("[data-velomark-root]") as HTMLDivElement | null
      )?.style.getPropertyValue("--velomark-color-surface-code")
    ).toBe(defaultTheme.color.surface.code);

    darkButton?.click();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(PLAYGROUND_THEME_STORAGE_KEY)).toBe("dark");
    expect(
      (
        container.querySelector("[data-velomark-root]") as HTMLDivElement | null
      )?.style.getPropertyValue("--velomark-color-surface-code")
    ).toBe(darkTheme.color.surface.code);

    dispose();
    container.remove();
  });
});
