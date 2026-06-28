import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { Velomark } from "../../render/velomark";
import { applyTheme } from "../apply-theme";
import { generateCssVars } from "../generate-css-vars";
import { mergeTheme } from "../merge-theme";
import { toMermaidThemeVariables } from "../to-mermaid-theme";
import {
  darkTheme,
  defaultTheme,
  velomarkColors,
  velomarkTokens,
} from "../tokens";
import type { VelomarkTheme } from "../types";

describe("velomark theme surface", () => {
  it("exports default and dark theme presets", () => {
    expect(defaultTheme).toBeDefined();
    expect(darkTheme).toBeDefined();
  });

  it("shapes preset themes as semantic velomark themes", () => {
    const themes: VelomarkTheme[] = [defaultTheme, darkTheme];

    for (const theme of themes) {
      expect(theme).toMatchObject({
        color: {
          text: {
            primary: expect.any(String),
            muted: expect.any(String),
            accent: expect.any(String),
            inverse: expect.any(String),
          },
          surface: {
            base: expect.any(String),
            elevated: expect.any(String),
            code: expect.any(String),
            codeStrong: expect.any(String),
            quote: expect.any(String),
            tableHeader: expect.any(String),
            tableStripe: expect.any(String),
            math: expect.any(String),
            diagram: expect.any(String),
          },
          border: {
            default: expect.any(String),
            strong: expect.any(String),
            accent: expect.any(String),
          },
          link: {
            default: expect.any(String),
            hover: expect.any(String),
          },
          code: {
            languageBadgeBackground: expect.any(String),
            languageBadgeForeground: expect.any(String),
            copyButtonBackground: expect.any(String),
            copyButtonForeground: expect.any(String),
            copyButtonHoverBackground: expect.any(String),
            copyButtonCopiedBackground: expect.any(String),
            copyButtonCopiedForeground: expect.any(String),
          },
          quote: {
            border: expect.any(String),
            foreground: expect.any(String),
          },
          diagram: {
            background: expect.any(String),
            text: expect.any(String),
            primary: expect.any(String),
            secondary: expect.any(String),
            border: expect.any(String),
            line: expect.any(String),
            nodeBackground: expect.any(String),
            nodeForeground: expect.any(String),
          },
        },
        typography: {
          bodyFont: expect.any(String),
          monoFont: expect.any(String),
          lineHeight: expect.any(String),
        },
        radius: {
          sm: expect.any(String),
          md: expect.any(String),
          lg: expect.any(String),
          pill: expect.any(String),
        },
        shadow: {
          xs: expect.any(String),
          sm: expect.any(String),
        },
        spacing: {
          blockGap: expect.any(String),
          inlineCodeX: expect.any(String),
          inlineCodeY: expect.any(String),
          codePaddingX: expect.any(String),
          codePaddingY: expect.any(String),
        },
      });
    }
  });

  it("keeps dark preset meaningfully different from the default preset", () => {
    expect(darkTheme.color.text.primary).not.toBe(
      defaultTheme.color.text.primary
    );
    expect(darkTheme.color.surface.base).not.toBe(
      defaultTheme.color.surface.base
    );
    expect(darkTheme.color.code.copyButtonBackground).not.toBe(
      defaultTheme.color.code.copyButtonBackground
    );
    expect(darkTheme.color.diagram.background).not.toBe(
      defaultTheme.color.diagram.background
    );
  });

  it("deeply merges partial theme overrides into the base theme", () => {
    const merged = mergeTheme(defaultTheme, {
      color: {
        text: {
          primary: "#101010",
        },
        code: {
          copyButtonBackground: "#202020",
        },
      },
      spacing: {
        blockGap: "1.5rem",
      },
    });

    expect(merged.color.text.primary).toBe("#101010");
    expect(merged.color.code.copyButtonBackground).toBe("#202020");
    expect(merged.spacing.blockGap).toBe("1.5rem");
    expect(merged.color.text.muted).toBe(defaultTheme.color.text.muted);
    expect(merged.radius.lg).toBe(defaultTheme.radius.lg);
  });

  it("generates semantic css variables from a theme object", () => {
    const cssVars = generateCssVars(defaultTheme);

    expect(cssVars["--velomark-color-text-primary"]).toBe(
      defaultTheme.color.text.primary
    );
    expect(cssVars["--velomark-color-surface-code"]).toBe(
      defaultTheme.color.surface.code
    );
    expect(cssVars["--velomark-color-diagram-node-background"]).toBe(
      defaultTheme.color.diagram.nodeBackground
    );
    expect(cssVars["--velomark-radius-lg"]).toBe(defaultTheme.radius.lg);
    expect(cssVars["--velomark-spacing-code-padding-x"]).toBe(
      defaultTheme.spacing.codePaddingX
    );
  });

  it("derives mermaid theme variables from the active velomark theme", () => {
    const lightMermaidTheme = toMermaidThemeVariables(defaultTheme);
    const darkMermaidTheme = toMermaidThemeVariables(darkTheme);

    expect(lightMermaidTheme.background).toBe(
      defaultTheme.color.diagram.background
    );
    expect(lightMermaidTheme.nodeBkg).toBe(
      defaultTheme.color.diagram.nodeBackground
    );
    expect(lightMermaidTheme.primaryColor).toBe(
      defaultTheme.color.diagram.primary
    );
    expect(lightMermaidTheme.darkMode).toBe(false);
    expect(darkMermaidTheme.darkMode).toBe(true);
    expect(darkMermaidTheme.textColor).toBe(darkTheme.color.diagram.text);
    expect(darkMermaidTheme.lineColor).toBe(darkTheme.color.diagram.line);
  });

  it("applies generated css variables to a container element", () => {
    const element = document.createElement("div");

    applyTheme(element, "dark");

    expect(
      element.style.getPropertyValue("--velomark-color-text-primary")
    ).toBe(darkTheme.color.text.primary);
    expect(
      element.style.getPropertyValue("--velomark-color-surface-base")
    ).toBe(darkTheme.color.surface.base);
    expect(element.style.getPropertyValue("--velomark-radius-md")).toBe(
      darkTheme.radius.md
    );
  });

  it('applies the dark preset when rendered with theme="dark"', () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => Velomark({ markdown: "Hello", theme: "dark" }),
      host
    );
    const root = host.querySelector(
      "[data-velomark-root]"
    ) as HTMLDivElement | null;

    expect(root?.style.getPropertyValue("--velomark-color-text-primary")).toBe(
      darkTheme.color.text.primary
    );
    expect(root?.style.getPropertyValue("--velomark-color-surface-base")).toBe(
      darkTheme.color.surface.base
    );

    dispose();
    host.remove();
  });

  it("merges partial theme overrides at the renderer root", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () =>
        Velomark({
          markdown: "Hello",
          theme: {
            color: {
              text: {
                primary: "#123456",
              },
            },
          },
        }),
      host
    );
    const root = host.querySelector(
      "[data-velomark-root]"
    ) as HTMLDivElement | null;

    expect(root?.style.getPropertyValue("--velomark-color-text-primary")).toBe(
      "#123456"
    );
    expect(root?.style.getPropertyValue("--velomark-color-surface-base")).toBe(
      defaultTheme.color.surface.base
    );

    dispose();
    host.remove();
  });

  it("maintains baseline compatibility exports for colors and tokens", () => {
    expect(velomarkColors).toMatchObject({
      text: expect.any(String),
      muted: expect.any(String),
      border: expect.any(String),
      accent: expect.any(String),
      codeBg: expect.any(String),
    });

    expect(velomarkTokens).toMatchObject({
      radius: expect.any(String),
      fontFamily: expect.any(String),
      lineHeight: expect.any(String),
      blockGap: expect.any(String),
      inlineCodePadding: expect.any(String),
    });
  });

  it("ships a consumable styles.css file", () => {
    const stylesPath = path.resolve(process.cwd(), "src/theme/styles.css");
    expect(existsSync(stylesPath)).toBe(true);
    const css = readFileSync(stylesPath, "utf8");

    expect(css).toContain(".velomark");
    expect(css).toContain("--velomark-color-text-primary");
    expect(css).toContain("--velomark-color-surface-code");
    expect(css).toContain("--velomark-spacing-block-gap");
    expect(css).not.toContain(".velomark > * + *");
    expect(css).not.toContain("line-height: var(--velomark-line-height)");
    expect(css).not.toContain("--velomark-color-text:");
  });
});
