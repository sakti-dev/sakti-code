// biome-ignore lint/performance/noBarrelFile: This package entrypoint intentionally re-exports the public API.
export { parseInline } from "./parser/inline-parser";
export type { VelomarkProps } from "./render/velomark";
export { Velomark } from "./render/velomark";
export { applyTheme, resolveTheme } from "./theme/apply-theme";
export { generateCssVars } from "./theme/generate-css-vars";
export type { PartialVelomarkTheme } from "./theme/merge-theme";
export { mergeTheme } from "./theme/merge-theme";
export {
  darkTheme,
  defaultTheme,
  velomarkColors,
  velomarkThemePresets,
  velomarkTokens,
} from "./theme/tokens";
export type { VelomarkTheme, VelomarkThemeName } from "./theme/types";
export type {
  InlineToken,
  RenderBlock,
  RenderDocument,
  VelomarkCodeBlockOptions,
  VelomarkCodeBlockRendererProps,
  VelomarkContainerRendererProps,
} from "./types";
