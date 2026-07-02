import { createSignal } from "solid-js";
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

export function SettingsPage() {
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
    <div class="flex min-h-screen flex-col bg-background">
      <div class="flex flex-1 overflow-hidden">
        <div class="w-56 shrink-0 border-border/80 border-r bg-background/35">
          <ScrollArea class="h-full">
            <SettingsSidebar activeTab={activeTab()} onTabChange={setActiveTab} />
          </ScrollArea>
        </div>

        <div class="flex flex-1 flex-col overflow-hidden">
          <div class="border-border/50 border-b px-6 pt-5 pb-4">
            <h1 class="font-semibold text-foreground text-lg">{activeTabLabel()}</h1>
            <p class="mt-0.5 text-muted-foreground text-sm">{activeTabDescription()}</p>
          </div>

          <ScrollArea class="flex-1">
            <div class="px-6 py-4">{activeTabContent()}</div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
