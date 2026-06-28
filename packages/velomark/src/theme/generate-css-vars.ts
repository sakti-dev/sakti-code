import type { VelomarkTheme } from "./types";

const toKebabCase = (value: string): string =>
  value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);

const walkTheme = (
  prefix: string,
  value: Record<string, unknown>,
  cssVars: Record<string, string>
): void => {
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPrefix = `${prefix}-${toKebabCase(key)}`;

    if (
      typeof nestedValue === "object" &&
      nestedValue !== null &&
      !Array.isArray(nestedValue)
    ) {
      walkTheme(nextPrefix, nestedValue as Record<string, unknown>, cssVars);
      continue;
    }

    cssVars[nextPrefix] = String(nestedValue);
  }
};

export const generateCssVars = (
  theme: VelomarkTheme
): Record<string, string> => {
  const cssVars: Record<string, string> = {};
  walkTheme("--velomark", theme as unknown as Record<string, unknown>, cssVars);
  return cssVars;
};
