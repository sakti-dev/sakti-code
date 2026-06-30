import type { PartialVelomarkTheme } from "velomark";

const desktopColor = (token: string) => `var(${token})`;
const desktopAlpha = (token: string, alpha: number) => `oklch(from var(${token}) l c h / ${alpha})`;

export const createDesktopVelomarkTheme = (): PartialVelomarkTheme => ({
  color: {
    text: {
      primary: desktopColor("--foreground"),
      muted: desktopColor("--muted-foreground"),
      accent: desktopColor("--primary"),
      inverse: desktopColor("--primary-foreground"),
    },
    surface: {
      base: "transparent",
      elevated: "transparent",
      code: desktopAlpha("--muted", 0.52),
      codeStrong: desktopAlpha("--muted", 0.8),
      quote: desktopAlpha("--muted", 0.45),
      tableHeader: desktopAlpha("--muted", 0.68),
      tableStripe: desktopAlpha("--muted", 0.38),
      math: desktopAlpha("--muted", 0.52),
      diagram: desktopAlpha("--card", 0.35),
    },
    border: {
      default: desktopAlpha("--border", 0.5),
      strong: desktopAlpha("--border", 0.6),
      accent: desktopAlpha("--primary", 0.55),
    },
    link: {
      default: desktopColor("--primary"),
      hover: desktopAlpha("--primary", 0.6),
    },
    code: {
      languageBadgeBackground: desktopAlpha("--muted", 0.68),
      languageBadgeForeground: desktopAlpha("--muted-foreground", 0.95),
      copyButtonBackground: desktopColor("--card"),
      copyButtonForeground: desktopColor("--foreground"),
      copyButtonHoverBackground: desktopAlpha("--muted", 0.8),
      copyButtonCopiedBackground: desktopColor("--primary"),
      copyButtonCopiedForeground: desktopColor("--primary-foreground"),
    },
    quote: {
      border: desktopAlpha("--primary", 0.55),
      foreground: desktopAlpha("--foreground", 0.86),
    },
    diagram: {
      background: desktopColor("--card"),
      text: desktopColor("--foreground"),
      primary: desktopColor("--primary"),
      secondary: desktopColor("--secondary"),
      border: desktopAlpha("--border", 0.5),
      line: desktopAlpha("--muted-foreground", 0.95),
      nodeBackground: desktopAlpha("--muted", 0.68),
      nodeForeground: desktopColor("--foreground"),
    },
  },
  typography: {
    bodyFont: desktopColor("--font-sans"),
    monoFont: desktopColor("--font-mono"),
    lineHeight: "1.75",
  },
  radius: {
    sm: "calc(var(--radius) - 2px)",
    md: "var(--radius)",
    lg: "var(--radius)",
    pill: "999px",
  },
  shadow: {
    xs: desktopColor("--shadow-xs"),
    sm: desktopColor("--shadow-sm"),
  },
  spacing: {
    blockGap: "1rem",
    inlineCodeX: "0.34rem",
    inlineCodeY: "0.12rem",
    codePaddingX: "1rem",
    codePaddingY: "0.85rem",
  },
});
