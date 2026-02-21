import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from "@/components/ui/switch";
import { createSignal, For } from "solid-js";

export function GeneralSettings() {
  const [defaultModel, setDefaultModel] = createSignal("Sonnet 4.5");
  const [defaultThinkingLevel, setDefaultThinkingLevel] = createSignal("Off");
  const [theme, setTheme] = createSignal("System");
  const [sessionNotifications, setSessionNotifications] = createSignal(true);
  const [completionSoundEffects, setCompletionSoundEffects] = createSignal(true);
  const [sendMessageWith, setSendMessageWith] = createSignal("Enter");
  const [stripConfirmation, setStripConfirmation] = createSignal(true);
  const [strictDataPrivacy, setStrictDataPrivacy] = createSignal(false);

  const models = ["Sonnet 4.5", "Sonnet 4", "GPT-4", "GPT-4 Turbo"];

  const thinkingLevels = ["Off", "Brief", "Detailed"];

  const themes = ["System", "Light", "Dark"];

  const messageSendOptions = ["Enter", "Ctrl+Enter"];

  return (
    <div class="space-y-0">
      <div class="border-border/70 flex items-center justify-between border-b px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Default model</label>
          <p class="text-muted-foreground text-xs">Choose the default model for new chats</p>
        </div>
        <div class="ml-6 w-40">
          <select
            class="border-border/80 bg-background/70 hover:bg-muted/60 focus:ring-primary/40 focus:ring-offset-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
            value={defaultModel()}
            onInput={e => setDefaultModel(e.currentTarget.value)}
          >
            <For each={models}>{model => <option value={model}>{model}</option>}</For>
          </select>
        </div>
      </div>

      <div class="border-border/70 flex items-center justify-between border-b px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Default thinking level</label>
          <p class="text-muted-foreground text-xs">Choose how much thinking new chats start with</p>
        </div>
        <div class="ml-6 w-40">
          <select
            class="border-border/80 bg-background/70 hover:bg-muted/60 focus:ring-primary/40 focus:ring-offset-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
            value={defaultThinkingLevel()}
            onInput={e => setDefaultThinkingLevel(e.currentTarget.value)}
          >
            <For each={thinkingLevels}>{level => <option value={level}>{level}</option>}</For>
          </select>
        </div>
      </div>

      <div class="border-border/70 flex items-center justify-between border-b px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Theme</label>
          <p class="text-muted-foreground text-xs">Toggle with ⌘⇧T</p>
        </div>
        <div class="ml-6 w-40">
          <select
            class="border-border/80 bg-background/70 hover:bg-muted/60 focus:ring-primary/40 focus:ring-offset-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
            value={theme()}
            onInput={e => setTheme(e.currentTarget.value)}
          >
            <For each={themes}>{t => <option value={t}>{t}</option>}</For>
          </select>
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
          <label class="text-foreground text-sm font-medium">Send messages with</label>
          <p class="text-muted-foreground text-xs">
            Choose which key combination sends messages
            <br />
            Use Shift+Enter for new lines
          </p>
        </div>
        <div class="ml-6 w-40">
          <select
            class="border-border/80 bg-background/70 hover:bg-muted/60 focus:ring-primary/40 focus:ring-offset-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
            value={sendMessageWith()}
            onInput={e => setSendMessageWith(e.currentTarget.value)}
          >
            <For each={messageSendOptions}>
              {option => <option value={option}>{option}</option>}
            </For>
          </select>
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

      <div class="border-border/70 flex items-center justify-between px-0 py-4">
        <div class="flex-1">
          <label class="text-foreground text-sm font-medium">Strict data privacy</label>
          <p class="text-muted-foreground text-xs">Enable enhanced data privacy measures</p>
        </div>
        <div class="ml-6">
          <Switch
            checked={strictDataPrivacy()}
            onChange={setStrictDataPrivacy}
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
