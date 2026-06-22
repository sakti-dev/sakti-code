import { createSignal } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { SETTINGS_TABS, SettingsSidebar } from "./settings-sidebar";
import { AgentsSettings } from "./tabs/agents-settings";
import { CommandsSettings } from "./tabs/commands-settings";
import { ExperimentalSettings } from "./tabs/experimental-settings";
import { GeneralSettings } from "./tabs/general-settings";
import { GitSettings } from "./tabs/git-settings";
import { HooksSettings } from "./tabs/hooks-settings";
import { McpSettings } from "./tabs/mcp-settings";
import { MemorySettings } from "./tabs/memory-settings";
import { ModelsSettings } from "./tabs/models-settings";
import { TerminalSettings } from "./tabs/terminal-settings";

interface SettingsDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [activeTab, setActiveTab] = createSignal("general");

  const activeTabLabel = () =>
    SETTINGS_TABS.find((t) => t.id === activeTab())?.label ?? "Settings";

  const activeTabDescription = () => {
    if (activeTab() === "general") {
      return "Configure your preferences";
    }
    return `Configure ${activeTab()} settings`;
  };

  const activeTabContent = () => {
    switch (activeTab()) {
      case "general":
        return <GeneralSettings />;
      case "models":
        return <ModelsSettings />;
      case "git":
        return <GitSettings />;
      case "terminal":
        return <TerminalSettings />;
      case "mcp":
        return <McpSettings />;
      case "commands":
        return <CommandsSettings />;
      case "agents":
        return <AgentsSettings />;
      case "memory":
        return <MemorySettings />;
      case "hooks":
        return <HooksSettings />;
      case "experimental":
        return <ExperimentalSettings />;
      case "changelog":
      case "docs":
        return (
          <div class="flex h-full items-center justify-center text-muted-foreground">
            <p>External link opened in new tab</p>
          </div>
        );
      default:
        return (
          <div class="flex h-full items-center justify-center text-muted-foreground">
            <p>
              {SETTINGS_TABS.find((t) => t.id === activeTab())?.label} settings
              coming soon
            </p>
          </div>
        );
    }
  };

  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogContent class="flex h-[600px] w-full max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader class="flex items-center justify-between border-border/80 border-b px-4 pt-4 pb-4">
          <div class="flex flex-col">
            <DialogTitle>{activeTabLabel()}</DialogTitle>
            <DialogDescription>{activeTabDescription()}</DialogDescription>
          </div>
        </DialogHeader>

        <div class="flex flex-1 overflow-hidden">
          <div class="w-56 shrink-0 border-border/80 border-r bg-background/35">
            <ScrollArea class="h-full">
              <SettingsSidebar
                activeTab={activeTab()}
                onTabChange={setActiveTab}
              />
            </ScrollArea>
          </div>

          <div class="flex-1 overflow-y-auto px-4 pb-0">
            <div class="max-h-full overflow-y-auto pr-2">
              {activeTabContent()}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
