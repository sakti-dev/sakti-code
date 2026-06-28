import type {
  BundledLanguage,
  BundledTheme,
  HighlighterGeneric,
  SpecialLanguage,
  ThemedToken,
  ThemeRegistrationAny,
} from "shiki";
import {
  type Component,
  createEffect,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { getShikiManager } from "./shiki-manager";

const DEFAULT_HIGHLIGHT_THEME = "github-dark";
const isBrowser = typeof window !== "undefined";
const FONT_STYLE_ITALIC_FLAG = 1;
const FONT_STYLE_BOLD_FLAG = 2;
const FONT_STYLE_UNDERLINE_FLAG = 4;

function hasFontStyleFlag(fontStyle: number, flag: number): boolean {
  // biome-ignore lint/suspicious/noBitwiseOperators: Shiki exposes fontStyle as a bit flag mask.
  return (fontStyle & flag) !== 0;
}

export const HighlightedCodeBlock: Component<{
  code: string;
  language?: string;
  theme?: string;
}> = (props) => {
  type ResolvedTheme = BundledTheme | ThemeRegistrationAny | "none";

  const [highlightedTokens, setHighlightedTokens] = createSignal<
    ThemedToken[][]
  >([]);
  const [streamError, setStreamError] = createSignal(false);
  const [resolvedLanguage, setResolvedLanguage] = createSignal<
    BundledLanguage | SpecialLanguage
  >("text");
  const [resolvedTheme, setResolvedTheme] = createSignal<ResolvedTheme>(
    DEFAULT_HIGHLIGHT_THEME as BundledTheme
  );
  const [highlighter, setHighlighter] = createSignal<HighlighterGeneric<
    BundledLanguage,
    BundledTheme
  > | null>(null);
  let requestId = 0;

  const highlightCode = (): void => {
    const currentHighlighter = highlighter();
    if (!isBrowser || currentHighlighter === null) {
      return;
    }

    requestId += 1;
    const currentRequestId = requestId;

    try {
      const tokens = currentHighlighter.codeToTokensBase(props.code, {
        lang: resolvedLanguage(),
        theme: resolvedTheme(),
      });
      if (currentRequestId !== requestId) {
        return;
      }

      setHighlightedTokens(tokens);
      setStreamError(false);
    } catch {
      if (currentRequestId !== requestId) {
        return;
      }

      setHighlightedTokens([]);
      setStreamError(true);
    }
  };

  createEffect(
    on(
      [() => props.language, () => props.theme],
      async ([nextLanguageInput, nextThemeInput]) => {
        const nextTheme = nextThemeInput ?? DEFAULT_HIGHLIGHT_THEME;
        const nextLanguage = nextLanguageInput?.trim() || "text";

        if (!isBrowser) {
          return;
        }

        try {
          const resolved = await getShikiManager().ensureLanguage(
            nextTheme as BundledTheme,
            nextLanguage
          );
          setResolvedLanguage(resolved.language);
          setResolvedTheme(nextTheme as BundledTheme);
          setHighlighter(resolved.highlighter);
          setStreamError(false);
          highlightCode();
        } catch {
          setHighlightedTokens([]);
          setStreamError(true);
        }
      },
      { defer: false }
    )
  );

  createEffect(
    on(
      () => props.code,
      () => {
        highlightCode();
      }
    )
  );

  return (
    <pre>
      <code data-velomark-code-highlighted={streamError() ? undefined : ""}>
        <Show
          fallback={props.code}
          when={!streamError() && highlightedTokens().length > 0}
        >
          <For each={highlightedTokens()}>
            {(line, lineIndex) => (
              <>
                <For each={line}>
                  {(token) => (
                    <span style={buildTokenStyle(token)}>{token.content}</span>
                  )}
                </For>
                <Show when={lineIndex() < highlightedTokens().length - 1}>
                  {"\n"}
                </Show>
              </>
            )}
          </For>
        </Show>
      </code>
    </pre>
  );
};

const buildTokenStyle = (token: ThemedToken): Record<string, string> => {
  const style: Record<string, string> = {};

  if (token.color) {
    style.color = token.color;
  }

  if (typeof token.fontStyle === "number") {
    if (hasFontStyleFlag(token.fontStyle, FONT_STYLE_ITALIC_FLAG)) {
      style["font-style"] = "italic";
    }

    if (hasFontStyleFlag(token.fontStyle, FONT_STYLE_BOLD_FLAG)) {
      style["font-weight"] = "700";
    }

    if (hasFontStyleFlag(token.fontStyle, FONT_STYLE_UNDERLINE_FLAG)) {
      style["text-decoration"] = "underline";
    }
  }

  return style;
};
