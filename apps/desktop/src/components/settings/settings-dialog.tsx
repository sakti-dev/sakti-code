import { createSignal } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [activeTab, setActiveTab] = createSignal("general");

  const activeTabLabel = () => SETTINGS_TABS.find((t) => t.id === activeTab())?.label ?? "Settings";

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
            <p>{SETTINGS_TABS.find((t) => t.id === activeTab())?.label} settings coming soon</p>
          </div>
        );
    }
  };

  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogTrigger
        class="flex items-center gap-1.5 rounded-md border-border bg-card px-2 py-1 font-medium text-foreground text-xs transition-colors hover:border-muted-foreground hover:bg-secondary"
        title="Settings"
      >
        <svg
          aria-label="Settings"
          class="h-3.5 w-3.5"
          fill="currentColor"
          role="img"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Settings</title>
          <path
            clip-rule="evenodd"
            d="M6.955 1.45A.5.5 0 0 1 7.452 1h1.096a.5.5 0 0 1 .497.45l.17 1.699c.484.12.94.312 1.356.562l1.321-.832a.5.5 0 0 1 .67.065l.774.775a.5.5 0 0 1 .066.67l-.832 1.32c.25.417.443.873.563 1.357l1.699.17a.5.5 0 0 1 .45.496v1.096a.5.5 0 0 1-.45.497l-1.699.17c-.12.484-.312.94-.562 1.356l.832 1.321a.5.5 0 0 1-.066.67l-.774.774a.5.5 0 0 1-.67.066l-1.32-.832c-.417.25-.873.443-1.357.563l-.17 1.699a.5.5 0 0 1-.497.45H7.452a.5.5 0 0 1-.497-.45l-.17-1.699a4.973 4.973 0 0 1-1.356-.562l-1.321.832a.5.5 0 0 1-.67-.066l-.774-.774a.5.5 0 0 1-.066-.67l.832-1.32a4.972 4.972 0 0 1-.563-1.357l-1.699-.17A.5.5 0 0 1 1 8.548V7.452a.5.5 0 0 1 .45-.497l1.699-.17c.12-.484.312-.94.562-1.356l-.832-1.321a.5.5 0 0 1 .066-.67l.774-.774a.5.5 0 0 1 .67-.066l1.32.832c.417-.25.873-.443 1.357-.563l.17-1.699zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
          />
        </svg>
      </DialogTrigger>
      <DialogContent class="flex h-[600px] w-full max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader class="flex items-center justify-between px-4 pt-4 pb-4">
          <div class="flex flex-col">
            <DialogTitle>{activeTabLabel()}</DialogTitle>
            <DialogDescription>{activeTabDescription()}</DialogDescription>
          </div>
        </DialogHeader>

        <div class="flex flex-1 overflow-hidden">
          <div class="w-56 shrink-0 border-border/80 border-r bg-background/35">
            <ScrollArea class="h-full">
              <SettingsSidebar activeTab={activeTab()} onTabChange={setActiveTab} />
            </ScrollArea>
          </div>

          <ScrollArea class="flex-1 pl-4">
            <div class="pr-4 pb-4">{activeTabContent()}</div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
