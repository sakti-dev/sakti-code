import type { Component, JSX } from "solid-js";
import { createSignal, splitProps } from "solid-js";

import { Dialog, DialogContent, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { SettingsRow } from "@/components/ui/settings-row";
import { SettingsSection } from "@/components/ui/settings-section";
import { SettingsSidebar } from "@/components/ui/settings-sidebar";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/utils";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SelectTrigger: Component<{
  class?: string;
  children?: JSX.Element;
  value?: string;
  placeholder?: string;
}> = props => {
  return (
    <button
      type="button"
      class={cn(
        "bg-background border-border ring-offset-background placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50 flex h-10 w-full items-center justify-between rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        props.class
      )}
    >
      <span class={props.value ? "text-foreground" : "text-muted-foreground"}>
        {props.value || props.placeholder || "Select..."}
      </span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-4 w-4 opacity-50"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
};

const SettingsDialog: Component<SettingsDialogProps> = props => {
  const [local, _others] = splitProps(props, ["open", "onOpenChange"]);
  const [selectedId, setSelectedId] = createSignal("general");

  const GeneralContent = () => {
    return (
      <div class="space-y-1">
        <SettingsSection title="Model">
          <SettingsRow label="Default Model" description="Model used by default for new sessions">
            <SelectTrigger class="w-[200px]" value="Claude Sonnet 4" placeholder="Select model" />
          </SettingsRow>
          <SettingsRow label="Thinking Level" description="Amount of reasoning effort">
            <SelectTrigger class="w-[200px]" value="Medium" placeholder="Select level" />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Appearance">
          <SettingsRow label="Theme" description="Application color scheme">
            <SelectTrigger class="w-[200px]" value="Dark" placeholder="Select theme" />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Notifications">
          <SettingsRow
            label="Session Notifications"
            description="Notify when sessions start or end"
          >
            <Switch checked={true} onChange={() => {}} />
          </SettingsRow>
          <SettingsRow
            label="Completion Sounds"
            description="Play sound when agent completes a task"
          >
            <Switch checked={true} onChange={() => {}} />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Behavior">
          <SettingsRow
            label="Send Messages"
            description="Automatically send messages when pressing Enter"
          >
            <Switch checked={true} onChange={() => {}} />
          </SettingsRow>
          <SettingsRow
            label="Not Absolutely Right"
            description="Confirm before executing potentially harmful commands"
          >
            <Switch checked={true} onChange={() => {}} />
          </SettingsRow>
          <SettingsRow
            label="Strict Privacy"
            description="Prevent sending code snippets to external services"
          >
            <Switch checked={false} onChange={() => {}} />
          </SettingsRow>
        </SettingsSection>
      </div>
    );
  };

  const renderContent = () => {
    const id = selectedId();
    switch (id) {
      case "general":
        return <GeneralContent />;
      default:
        return (
          <div class="text-muted-foreground flex h-full items-center justify-center">
            <p>Settings for {selectedId()} coming soon...</p>
          </div>
        );
    }
  };

  return (
    <Dialog open={local.open} onOpenChange={local.onOpenChange}>
      <DialogPortal>
        <DialogOverlay class="bg-black/80 backdrop-blur-sm" />
        <DialogContent class="h-[640px] w-[900px] max-w-[90vw] overflow-hidden p-0">
          <div class="grid h-full min-h-0 gap-0 md:grid-cols-[1.1fr_1.4fr]">
            {/* Left sidebar */}
            <div class="border-border/80 min-h-0 border-r">
              <SettingsSidebar selectedId={selectedId()} onItemSelect={setSelectedId} />
            </div>

            {/* Right content */}
            <div class="bg-background/30 min-h-0 overflow-y-auto p-6">{renderContent()}</div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};

export { SettingsDialog };
export type { SettingsDialogProps };
