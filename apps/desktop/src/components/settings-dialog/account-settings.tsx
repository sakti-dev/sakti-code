import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from "@/components/ui/switch";
import { createSignal } from "solid-js";

export function AccountSettings() {
  const [notifications, setNotifications] = createSignal(true);
  const [emailUpdates, setEmailUpdates] = createSignal(false);

  return (
    <div class="space-y-0">
      <div class="border-border/70 flex items-center justify-between border-b px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Account notifications</label>
          <p class="text-muted-foreground text-xs">Receive notifications about your account</p>
        </div>
        <div class="ml-6">
          <Switch
            checked={notifications()}
            onChange={setNotifications}
            class="flex items-center gap-3"
          >
            <SwitchLabel>Enabled</SwitchLabel>
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </div>
      </div>
      <div class="border-border/70 flex items-center justify-between px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Email updates</label>
          <p class="text-muted-foreground text-xs">Receive product updates via email</p>
        </div>
        <div class="ml-6">
          <Switch
            checked={emailUpdates()}
            onChange={setEmailUpdates}
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
