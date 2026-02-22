import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/utils";
import {
  Book,
  Boxes,
  Brain,
  Cloud,
  ExternalLink,
  FileText,
  GitBranch,
  Hammer,
  Slash,
  Terminal,
  User,
} from "lucide-solid";
import type { Component } from "solid-js";
import { For, Show, createSignal } from "solid-js";

const ZapIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polygon points="13 2 3 14 7 13 14 16 14 15 12 12 22 12 22 16 22 16 14 16 14 15 12 15 12 3 3" />
  </svg>
);

export interface SettingsTab {
  id: string;
  label: string;
  icon: Component<{ class?: string }>;
  external?: boolean;
  href?: string;
}

export const SETTINGS_TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: User },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "mcp", label: "MCP", icon: Hammer },
  { id: "commands", label: "Commands", icon: Slash },
  { id: "agents", label: "Agents", icon: Brain },
  { id: "memory", label: "Memory", icon: ZapIcon },
  { id: "hooks", label: "Hooks", icon: Cloud },
  { id: "models", label: "Models", icon: Boxes },
  { id: "experimental", label: "Experimental", icon: FileText },
  { id: "changelog", label: "Changelog", icon: Book, external: true, href: "https://github.com" },
  { id: "docs", label: "Docs", icon: Book, external: true, href: "https://docs.ekacode.dev" },
];

interface DialogSidebarProps {
  tabs: SettingsTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function DialogSidebar(props: DialogSidebarProps) {
  return (
    <div class="flex flex-col gap-1 px-2 py-2">
      <For each={props.tabs}>
        {tab => {
          const isActive = () => props.activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              type="button"
              class={cn(
                "duration-120 group w-full rounded-md border px-2.5 py-2 text-left transition-all",
                isActive()
                  ? "border-primary/45 bg-accent/70 shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_45%,transparent),0_8px_24px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]"
                  : "hover:border-border/90 hover:bg-muted/70 border-transparent"
              )}
              onClick={() => {
                if (tab.external && tab.href) {
                  window.open(tab.href, "_blank", "noopener,noreferrer");
                } else {
                  props.onTabChange(tab.id);
                }
              }}
            >
              <div class="flex items-center gap-3">
                <Icon
                  class={cn(
                    "size-4 shrink-0",
                    isActive() ? "text-foreground" : "text-muted-foreground"
                  )}
                />
                <span class="truncate text-sm font-medium">{tab.label}</span>
              </div>
              <Show when={tab.external}>
                <ExternalLink class="size-3.5 shrink-0 opacity-50" />
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
}

import type { ProviderClient } from "@/core/services/api/provider-client";
import { AgentsSettings } from "./agents-settings";
import { CommandsSettings } from "./commands-settings";
import { ExperimentalSettings } from "./experimental-settings";
import { GeneralSettings } from "./general-settings";
import { GitSettings } from "./git-settings";
import { HooksSettings } from "./hooks-settings";
import { McpSettings } from "./mcp-settings";
import { MemorySettings } from "./memory-settings";
import { ModelsSettings } from "./models-settings";
import { TerminalSettings } from "./terminal-settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerClient?: ProviderClient;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [activeTab, setActiveTab] = createSignal("general");

  const activeTabContent = () => {
    switch (activeTab()) {
      case "general":
        return <GeneralSettings />;
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
      case "models":
        return <ModelsSettings client={props.providerClient} />;
      case "experimental":
        return <ExperimentalSettings />;
      case "changelog":
      case "docs":
        return (
          <div class="text-muted-foreground flex h-full items-center justify-center">
            <p>External link opened in new tab</p>
          </div>
        );
      default:
        return (
          <div class="text-muted-foreground flex h-full items-center justify-center">
            <p>{SETTINGS_TABS.find(t => t.id === activeTab())?.label} settings coming soon</p>
          </div>
        );
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="flex h-[600px] w-full max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader class="border-border/80 flex items-center justify-between border-b px-4 pb-4 pt-4">
          <div class="flex flex-col">
            <DialogTitle>{SETTINGS_TABS.find(t => t.id === activeTab())?.label}</DialogTitle>
            <DialogDescription>
              {activeTab() === "general"
                ? "Configure your Conductor preferences"
                : `Configure ${activeTab()} settings`}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div class="flex flex-1 overflow-hidden">
          <div class="border-border/80 bg-background/35 w-56 shrink-0 border-r">
            <div class="[&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50 h-full min-h-0 overflow-y-auto overscroll-contain [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2">
              <DialogSidebar
                tabs={SETTINGS_TABS}
                activeTab={activeTab()}
                onTabChange={setActiveTab}
              />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto px-4 pb-0">
            <div class="scrollbar-thin max-h-full overflow-y-auto pr-2">{activeTabContent()}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
