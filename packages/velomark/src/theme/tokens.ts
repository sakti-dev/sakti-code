import { darkTheme as darkThemePreset } from "./dark-theme";
import { defaultTheme as defaultThemePreset } from "./default-theme";

// biome-ignore lint/performance/noBarrelFile: This module intentionally groups theme presets and tokens for the public API.
export { velomarkColors } from "./colors";
export { darkTheme } from "./dark-theme";
export { defaultTheme } from "./default-theme";

export const velomarkTokens = {
  radius: "0.5rem",
  fontFamily:
    '"IBM Plex Sans", "Iosevka Aile", ui-sans-serif, system-ui, sans-serif',
  lineHeight: "1.6",
  blockGap: "1rem",
  inlineCodePadding: "0.1rem 0.35rem",
} as const;

export const velomarkThemePresets = {
  dark: darkThemePreset,
  default: defaultThemePreset,
} as const;
