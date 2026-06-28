import { darkTheme } from "./dark-theme";
import { defaultTheme } from "./default-theme";
import { generateCssVars } from "./generate-css-vars";
import { mergeTheme, type PartialVelomarkTheme } from "./merge-theme";
import type { VelomarkTheme, VelomarkThemeName } from "./types";

export const resolveTheme = (
  theme?: VelomarkThemeName | PartialVelomarkTheme | VelomarkTheme
): VelomarkTheme => {
  if (theme === "dark") {
    return darkTheme;
  }

  if (theme === "default" || theme === undefined) {
    return defaultTheme;
  }

  return mergeTheme(defaultTheme, theme);
};

export const applyTheme = (
  element: HTMLElement,
  theme?: VelomarkThemeName | PartialVelomarkTheme | VelomarkTheme
): VelomarkTheme => {
  const resolvedTheme = resolveTheme(theme);
  const cssVars = generateCssVars(resolvedTheme);

  for (const [key, value] of Object.entries(cssVars)) {
    element.style.setProperty(key, value);
  }

  return resolvedTheme;
};
