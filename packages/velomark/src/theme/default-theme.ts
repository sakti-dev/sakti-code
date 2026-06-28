import type { VelomarkTheme } from "./types";

export const defaultTheme: VelomarkTheme = {
  color: {
    text: {
      primary: "#243041",
      muted: "#5f6e82",
      accent: "#235fbc",
      inverse: "#f8fafc",
    },
    surface: {
      base: "#ffffff",
      elevated: "#f8fafc",
      code: "#f5f7fb",
      codeStrong: "#edf2f7",
      quote: "#f8fafc",
      tableHeader: "#edf2f7",
      tableStripe: "#f8fafc",
      math: "#f5f7fb",
      diagram: "#ffffff",
    },
    border: {
      default: "#d7dee8",
      strong: "#b8c4d4",
      accent: "#90b5eb",
    },
    link: {
      default: "#235fbc",
      hover: "#1c4e9d",
    },
    code: {
      languageBadgeBackground: "#edf2f7",
      languageBadgeForeground: "#4d5d72",
      copyButtonBackground: "#ffffff",
      copyButtonForeground: "#243041",
      copyButtonHoverBackground: "#edf2f7",
      copyButtonCopiedBackground: "#235fbc",
      copyButtonCopiedForeground: "#f8fafc",
    },
    quote: {
      border: "#90b5eb",
      foreground: "#506174",
    },
    diagram: {
      background: "#ffffff",
      text: "#243041",
      primary: "#235fbc",
      secondary: "#4f8fe9",
      border: "#b8c4d4",
      line: "#4d5d72",
      nodeBackground: "#edf2f7",
      nodeForeground: "#243041",
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
    xs: "0 1px 3px 0 hsl(210 30% 18% / 0.08)",
    sm: "0 6px 18px -10px hsl(210 30% 18% / 0.18)",
  },
  spacing: {
    blockGap: "1rem",
    inlineCodeX: "0.35rem",
    inlineCodeY: "0.1rem",
    codePaddingX: "1rem",
    codePaddingY: "0.875rem",
  },
};
