import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
} from "solid-js";
import { buildBandGradient } from "./build-band-gradient";
import { easingPresets, gradientPresets } from "./presets";
import type { GradientInput, GradientShimmerProps, GradientStop } from "./types";
import {
  observeShimmerActive,
  prefersReducedMotion,
  supportsBackgroundClipText,
} from "./visibility";

const FALLBACK_TEXT_WIDTH_PX = 96;
const MAX_SPREAD_PX = 48;
const SPREAD_MID_RATIO = 0.72;
const BASE_FONT_PX = 14;
const DEFAULT_DURATION_SECONDS = 1.45;
const DEFAULT_SPREAD = 3;
const DEFAULT_ANGLE = 105;

const resolveStops = (gradient: GradientInput | undefined): GradientStop[] => {
  if (!gradient) {
    return gradientPresets.sunrise;
  }
  if (typeof gradient === "string") {
    return gradientPresets[gradient] ?? gradientPresets.sunrise;
  }
  return gradient;
};

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

/**
 * A text shimmer that sweeps a multi-stop gradient highlight across its text.
 * Web-Animations-API driven, zero runtime dependencies.
 */
export const GradientShimmer: Component<GradientShimmerProps> = (props) => {
  const children = () => props.children;
  const safeDuration = () =>
    Math.max(0.001, finiteOr(props.duration ?? DEFAULT_DURATION_SECONDS, DEFAULT_DURATION_SECONDS));
  const safeSpread = () => Math.max(0, finiteOr(props.spread ?? DEFAULT_SPREAD, DEFAULT_SPREAD));
  const safeAngle = () => finiteOr(props.angle ?? DEFAULT_ANGLE, DEFAULT_ANGLE);
  const easingValue = () => easingPresets[props.easing ?? "smooth"] ?? easingPresets.smooth;

  const stops = createMemo(() => resolveStops(props.gradient));
  const backgroundImage = createMemo(() => buildBandGradient(stops(), safeAngle()));

  const initialSpread = () => Math.min(children().length * safeSpread(), MAX_SPREAD_PX);

  const [refEl, setRefEl] = createSignal<HTMLElement | null>(null);

  createEffect(() => {
    const el = refEl();
    if (!el) {
      return;
    }

    // NOTE: Do NOT read children() here — text changes on every streaming
    // token, and reading it would tear down and rebuild the animation
    // continuously. measure() reads text length from the DOM instead.
    const spread = safeSpread();
    const duration = safeDuration();
    const easing = easingValue();
    const pauseBetween = props.pauseBetween ?? 1000;
    const pauseOnScroll = props.pauseOnScroll ?? true;
    const pauseWhenOffscreen = props.pauseWhenOffscreen ?? true;
    const respectReducedMotion = props.respectReducedMotion ?? true;

    const measure = () => {
      const textWidth = el.getBoundingClientRect().width || FALLBACK_TEXT_WIDTH_PX;
      const fontSize = Number.parseFloat(getComputedStyle(el).fontSize) || BASE_FONT_PX;
      const fontScale = fontSize / BASE_FONT_PX;
      const textLength = el.textContent?.length ?? 1;
      const spreadPx = Math.min(textLength * spread * fontScale, MAX_SPREAD_PX * fontScale);
      const layerWidth = Math.max(1, textWidth + spreadPx * 2);
      const start = -spreadPx - layerWidth / 2;
      const end = textWidth + spreadPx - layerWidth / 2;
      const durationMs = duration * 1000;
      el.style.setProperty("--gs-spread", `${spreadPx}px`);
      el.style.setProperty("--gs-spread-mid", `${spreadPx * SPREAD_MID_RATIO}px`);
      el.style.backgroundSize = `${layerWidth}px 100%`;
      return { start, end, durationMs };
    };

    if (!supportsBackgroundClipText()) {
      el.style.removeProperty("background-image");
      el.style.removeProperty("-webkit-text-fill-color");
      return;
    }

    measure();

    if (respectReducedMotion && prefersReducedMotion()) {
      return;
    }
    if (typeof el.animate !== "function") {
      return;
    }

    let anim: Animation | null = null;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let cancelled = false;

    const runSweep = () => {
      if (cancelled) {
        return;
      }
      const { start, end, durationMs } = measure();
      const next = el.animate(
        [{ backgroundPosition: `${start}px center` }, { backgroundPosition: `${end}px center` }],
        { duration: durationMs, easing, fill: "forwards" },
      );
      if (!active) {
        next.pause();
      }
      anim?.cancel();
      anim = next;
      next.onfinish = () => {
        pauseTimer = setTimeout(runSweep, Math.max(0, pauseBetween));
      };
    };

    const stopVisibility = observeShimmerActive(
      el,
      { pauseOnScroll, pauseWhenOffscreen },
      (next) => {
        active = next;
        if (anim) {
          if (active) {
            anim.play();
          } else {
            anim.pause();
          }
        }
      },
    );

    runSweep();

    onCleanup(() => {
      cancelled = true;
      anim?.cancel();
      clearTimeout(pauseTimer);
      stopVisibility();
    });
  });

  const mergedStyle = (): JSX.CSSProperties =>
    ({
      ...props.style,
      "--gs-base": props.baseColor ?? "currentColor",
      "--gs-spread": `${initialSpread()}px`,
      "--gs-spread-mid": `${initialSpread() * SPREAD_MID_RATIO}px`,
      "background-clip": "text",
      "background-color": "var(--gs-base)",
      "background-image": backgroundImage(),
      "background-repeat": "no-repeat",
      "background-size": "100% 100%",
      display: "inline-block",
      position: "relative",
      "-webkit-background-clip": "text",
      "-webkit-text-fill-color": "transparent",
    }) as JSX.CSSProperties;

  return (
    <span class={props.class} ref={setRefEl} style={mergedStyle()}>
      {children()}
    </span>
  );
};
