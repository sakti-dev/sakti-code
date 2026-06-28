import { createEffect, createSignal } from "solid-js";

export type PlaygroundTheme = "dark" | "light";

export const PLAYGROUND_THEME_STORAGE_KEY = "velomark-playground-theme";
const DEFAULT_PLAYGROUND_THEME: PlaygroundTheme = "dark";

const readInitialTheme = (): PlaygroundTheme => {
  if (typeof window === "undefined") {
    return DEFAULT_PLAYGROUND_THEME;
  }

  const storedTheme = window.localStorage.getItem(PLAYGROUND_THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return DEFAULT_PLAYGROUND_THEME;
};

export const usePlaygroundTheme = () => {
  const [theme, setTheme] = createSignal<PlaygroundTheme>(readInitialTheme());

  createEffect(() => {
    const nextTheme = theme();
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    window.localStorage.setItem(PLAYGROUND_THEME_STORAGE_KEY, nextTheme);
  });

  return {
    setTheme,
    theme,
  };
};
