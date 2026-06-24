import type { JSX } from "solid-js";

/** A single stop in the highlight band, positioned 0..1 across the sweep. */
export interface GradientStop {
  color: string;
  position: number;
}

export type GradientPresetName =
  | "sunrise"
  | "bubble"
  | "peach"
  | "tonic"
  | "mint"
  | "spring"
  | "twilight"
  | "bay";

/** Either an explicit multi-stop gradient or a built-in preset name. */
export type GradientInput = GradientStop[] | GradientPresetName;

/** Named easing presets for the sweep (no raw cubic-bezier in the public API). */
export type EasingPreset = "smooth" | "gentle" | "snappy";

export interface GradientShimmerProps {
  /** Gradient angle in degrees. Defaults to `105`. */
  angle?: number;
  /** Base text color the band fades into. Defaults to `"currentColor"`. */
  baseColor?: string;
  /** The text to shimmer. Plain string only — the gradient sweeps over it. */
  children: string;
  class?: string;
  /** Sweep duration in seconds (constant regardless of text width). Defaults to `1.45`. */
  duration?: number;
  /** Sweep curve. Defaults to `"smooth"`. */
  easing?: EasingPreset;
  /** Multi-stop gradient or a preset name. Defaults to `"sunrise"`. */
  gradient?: GradientInput;
  /** Idle gap (ms) after each sweep before the next one. Defaults to `1000`. */
  pauseBetween?: number;
  /** Pause the sweep while the page is scrolling. Defaults to `true`. */
  pauseOnScroll?: boolean;
  /** Pause while outside the viewport. Defaults to `true`. */
  pauseWhenOffscreen?: boolean;
  /** Render a static gradient (no sweep) under `prefers-reduced-motion`. Defaults to `true`. */
  respectReducedMotion?: boolean;
  /** Highlight band width in px per character; scales with font size. Defaults to `3`. */
  spread?: number;
  style?: JSX.CSSProperties;
}
