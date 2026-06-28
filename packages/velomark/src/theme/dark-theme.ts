import type { VelomarkTheme } from "./types";

export const darkTheme: VelomarkTheme = {
  color: {
    text: {
      primary: "#e5e7eb",
      muted: "#94a3b8",
      accent: "#67c5ff",
      inverse: "#0f172a",
    },
    surface: {
      base: "#111827",
      elevated: "#0b1220",
      code: "#0f172a",
      codeStrong: "#020617",
      quote: "#111827",
      tableHeader: "#172133",
      tableStripe: "#0f172a",
      math: "#0f172a",
      diagram: "#111827",
    },
    border: {
      default: "#334155",
      strong: "#475569",
      accent: "#38bdf8",
    },
    link: {
      default: "#67c5ff",
      hover: "#93dcff",
    },
    code: {
      languageBadgeBackground: "#0b1220",
      languageBadgeForeground: "#94a3b8",
      copyButtonBackground: "#0b1220",
      copyButtonForeground: "#e5e7eb",
      copyButtonHoverBackground: "#172133",
      copyButtonCopiedBackground: "#0ea5e9",
      copyButtonCopiedForeground: "#f8fafc",
    },
    quote: {
      border: "#334155",
      foreground: "#94a3b8",
    },
    diagram: {
      background: "#111827",
      text: "#e5e7eb",
      primary: "#38bdf8",
      secondary: "#67c5ff",
      border: "#475569",
      line: "#94a3b8",
      nodeBackground: "#0f172a",
      nodeForeground: "#e5e7eb",
    },
  },
  typography: {
    bodyFont:
      '"IBM Plex Sans", "Iosevka Aile", ui-sans-serif, system-ui, sans-serif',
    monoFont:
      '"Iosevka Term", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
    lineHeight: "1.6",
  },
  radius: {
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.75rem",
    pill: "999px",
  },
  shadow: {
    xs: "0 1px 3px 0 hsl(220 40% 2% / 0.28)",
    sm: "0 10px 24px -12px hsl(220 40% 2% / 0.55)",
  },
  spacing: {
    blockGap: "1rem",
    inlineCodeX: "0.35rem",
    inlineCodeY: "0.1rem",
    codePaddingX: "1rem",
    codePaddingY: "0.875rem",
  },
};
