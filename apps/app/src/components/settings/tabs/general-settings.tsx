import { useColorMode } from "@kobalte/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

export function GeneralSettings() {
  const { colorMode, setColorMode } = useColorMode();

  const THEMES = ["System", "Light", "Dark"] as const;
  type ThemeLabel = (typeof THEMES)[number];

  const currentTheme = (): ThemeLabel => {
    const stored = localStorage.getItem("sakti-theme");
    if (stored === '"system"' || stored === "system") {
      return "System";
    }
    return colorMode() === "dark" ? "Dark" : "Light";
  };

  const handleSelectTheme = (value: ThemeLabel | null) => {
    if (!value) {
      return;
    }
    if (value === "System") {
      localStorage.setItem("sakti-theme", '"system"');
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      setColorMode(prefersDark ? "dark" : "light");
    } else {
      localStorage.setItem("sakti-theme", `"${value.toLowerCase()}"`);
      setColorMode(value.toLowerCase() as "light" | "dark");
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
          <Select
            itemComponent={(props) => (
              <SelectItem item={props.item}>{props.item.rawValue}</SelectItem>
            )}
            onChange={handleSelectTheme}
            options={[...THEMES]}
            placeholder="Select theme…"
            value={currentTheme()}
          >
            <SelectTrigger aria-label="Theme" class="w-full">
              <SelectValue<string>>{currentTheme()}</SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
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
