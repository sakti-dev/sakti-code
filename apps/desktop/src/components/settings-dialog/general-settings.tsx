import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from "@/components/ui/switch";
import { createSignal } from "solid-js";

export function GeneralSettings() {
  const [theme, setTheme] = createSignal("System");
  const [sessionNotifications, setSessionNotifications] = createSignal(true);
  const [completionSoundEffects, setCompletionSoundEffects] = createSignal(true);
  const [stripConfirmation, setStripConfirmation] = createSignal(true);

  const themes = ["System", "Light", "Dark"];

  return (
    <div class="space-y-0">
      <div class="border-border/70 flex items-center justify-between border-b px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Theme</label>
          <p class="text-muted-foreground text-xs">Toggle with ⌘⇧T</p>
        </div>
        <div class="ml-6 w-40">
          <Select
            value={theme()}
            onChange={setTheme}
            options={themes}
            placeholder="Select theme…"
            itemComponent={props => (
              <SelectItem item={props.item}>{props.item.rawValue}</SelectItem>
            )}
          >
            <SelectTrigger aria-label="Theme" class="w-full">
              <SelectValue<string>>{theme()}</SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
      </div>

      <div class="border-border/70 flex items-center justify-between border-b px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Session notifications</label>
          <p class="text-muted-foreground text-xs">
            Get notified when AI finishes working in a session.
          </p>
        </div>
        <div class="ml-6">
          <Switch
            checked={sessionNotifications()}
            onChange={setSessionNotifications}
            class="flex items-center gap-3"
          >
            <SwitchLabel>Enabled</SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </div>
      </div>

      <div class="border-border/70 flex items-center justify-between border-b px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Completion sound effects</label>
          <p class="text-muted-foreground text-xs">
            Play a sound when AI finishes working in a session.
          </p>
        </div>
        <div class="ml-6">
          <Switch
            checked={completionSoundEffects()}
            onChange={setCompletionSoundEffects}
            class="flex items-center gap-3"
          >
            <SwitchLabel>Enabled</SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </div>
      </div>

      <div class="border-border/70 flex items-center justify-between border-b px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">
            I'm not absolutely right, thank you very much
          </label>
          <p class="text-muted-foreground text-xs">
            Strip "You're absolutely right!" from AI messages
          </p>
        </div>
        <div class="ml-6">
          <Switch
            checked={stripConfirmation()}
            onChange={setStripConfirmation}
            class="flex items-center gap-3"
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
