import {
  type ColorMode,
  ColorModeProvider,
  createLocalStorageManager,
  useColorMode,
} from "@kobalte/core";
import { createEffect, type ParentProps } from "solid-js";

const STORAGE_KEY = "sakti-theme";
const storageManager = createLocalStorageManager(STORAGE_KEY);

/**
 * Inline script that sets `data-kb-theme`, `.dark` class, and `color-scheme`
 * synchronously before first paint. Extends Kobalte's ColorModeScript by
 * also toggling the `.dark` class — needed by libraries like velomark that
 * use `.dark` class selectors in their raw CSS.
 */
function ThemeScript(props: { initialColorMode: ColorMode }) {
  const script = [
    "!(function(){try{",
    `var k="${STORAGE_KEY}",m="${props.initialColorMode}",`,
    'v=window.matchMedia("(prefers-color-scheme: dark)").matches,',
    'r="system"===m?(v?"dark":"light"):m,',
    'o=document.documentElement,i="dark"===r;',
    'o.style.colorScheme=r,o.dataset.kbTheme=r,o.classList.toggle("dark",i);',
    "var t=localStorage.getItem(k);",
    'if(t){var s="dark"===t;o.style.colorScheme=t,o.dataset.kbTheme=t,o.classList.toggle("dark",s)}',
    "else localStorage.setItem(k,r)",
    "}catch(e){}})();",
  ].join("");
  return <script innerHTML={script} />;
}

/** Keeps `.dark` class in sync when the user toggles color mode at runtime. */
function DarkClassSync() {
  const { colorMode } = useColorMode();
  createEffect(() => {
    document.documentElement.classList.toggle("dark", colorMode() === "dark");
  });
  return null;
}

export function ThemeProvider(props: ParentProps<{ initialColorMode?: ColorMode }>) {
  const mode = (): ColorMode => props.initialColorMode ?? "dark";
  return (
    <>
      <ThemeScript initialColorMode={mode()} />
      <ColorModeProvider initialColorMode={mode()} storageManager={storageManager}>
        <DarkClassSync />
        {props.children}
      </ColorModeProvider>
    </>
  );
}
