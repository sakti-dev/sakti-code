import { useColorMode } from "@kobalte/core";
import { For } from "solid-js";
import { cn } from "~/lib/utils";

type ThemeChoice = "light" | "dark" | "system";

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function CheckIcon() {
  return (
    <svg
      aria-label="Selected"
      class="ml-auto h-4 w-4 shrink-0 text-foreground"
      fill="currentColor"
      role="img"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Selected</title>
      <path
        clip-rule="evenodd"
        d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207z"
      />
    </svg>
  );
}

export function GeneralSettings() {
  const { colorMode, setColorMode } = useColorMode();

  const currentChoice = (): ThemeChoice => {
    const stored = localStorage.getItem("sakti-theme");
    if (stored === '"system"' || stored === "system") {
      return "system";
    }
    return colorMode() as ThemeChoice;
  };

  const handleSelectTheme = (choice: ThemeChoice) => {
    if (choice === "system") {
      localStorage.setItem("sakti-theme", '"system"');
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      setColorMode(prefersDark ? "dark" : "light");
    } else {
      localStorage.setItem("sakti-theme", `"${choice}"`);
      setColorMode(choice);
    }
  };

  return (
    <div class="space-y-0">
      <div class="flex items-center justify-between border-border/70 border-b px-0 py-4">
        <div class="flex-1">
          <p class="font-medium text-foreground text-sm">Theme</p>
          <p class="text-muted-foreground text-xs">Toggle with Ctrl+Shift+T</p>
        </div>
        <div class="ml-6 w-40">
          <div class="flex flex-col gap-1.5">
            <For each={THEME_OPTIONS}>
              {(opt) => (
                <button
                  class={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2 transition-all",
                    currentChoice() === opt.value
                      ? "border-primary bg-secondary"
                      : "border-border hover:border-muted-foreground hover:bg-secondary"
                  )}
                  onClick={() => handleSelectTheme(opt.value)}
                  type="button"
                >
                  <span
                    class={cn(
                      "font-medium text-xs",
                      currentChoice() === opt.value
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {opt.label}
                  </span>
                  {currentChoice() === opt.value && <CheckIcon />}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between border-border/70 border-b px-0 py-4">
        <div class="flex-1">
          <p class="font-medium text-foreground text-sm">
            Session notifications
          </p>
          <p class="text-muted-foreground text-xs">
            Get notified when AI finishes working in a session.
          </p>
        </div>
        <div class="ml-6">
          <span class="text-muted-foreground text-xs">Coming soon</span>
        </div>
      </div>

      <div class="flex items-center justify-between border-border/70 border-b px-0 py-4">
        <div class="flex-1">
          <p class="font-medium text-foreground text-sm">
            Completion sound effects
          </p>
          <p class="text-muted-foreground text-xs">
            Play a sound when AI finishes working in a session.
          </p>
        </div>
        <div class="ml-6">
          <span class="text-muted-foreground text-xs">Coming soon</span>
        </div>
      </div>

      <div class="flex items-center justify-between border-border/70 border-b px-0 py-4">
        <div class="flex-1">
          <p class="font-medium text-foreground text-sm">
            Strip confirmation messages
          </p>
          <p class="text-muted-foreground text-xs">
            Strip "You're absolutely right!" from AI messages
          </p>
        </div>
        <div class="ml-6">
          <span class="text-muted-foreground text-xs">Coming soon</span>
        </div>
      </div>
    </div>
  );
}
