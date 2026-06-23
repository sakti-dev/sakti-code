import { useColorMode } from "@kobalte/core";
import { createSignal } from "solid-js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Switch,
  SwitchControl,
  SwitchLabel,
  SwitchThumb,
} from "~/components/ui/switch";

export function GeneralSettings() {
  const { colorMode, setColorMode } = useColorMode();

  const THEMES = ["System", "Light", "Dark"] as const;
  type ThemeLabel = (typeof THEMES)[number];

  const [sessionNotifications, setSessionNotifications] = createSignal(true);
  const [completionSoundEffects, setCompletionSoundEffects] =
    createSignal(true);
  const [stripConfirmation, setStripConfirmation] = createSignal(true);

  const currentTheme = (): ThemeLabel =>
    colorMode() === "dark" ? "Dark" : "Light";

  const handleSelectTheme = (value: ThemeLabel | null) => {
    if (!value) {
      return;
    }
    if (value === "System") {
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      setColorMode(prefersDark ? "dark" : "light");
    } else {
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
          <Switch
            checked={sessionNotifications()}
            class="flex items-center gap-3"
            onChange={setSessionNotifications}
          >
            <SwitchLabel>Enabled</SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
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
          <Switch
            checked={completionSoundEffects()}
            class="flex items-center gap-3"
            onChange={setCompletionSoundEffects}
          >
            <SwitchLabel>Enabled</SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
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
          <Switch
            checked={stripConfirmation()}
            class="flex items-center gap-3"
            onChange={setStripConfirmation}
          >
            <SwitchLabel>Enabled</SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </div>
      </div>
    </div>
  );
}
