import { cn } from "@/utils";
import {
  Book,
  Brain,
  Cloud,
  ExternalLink,
  FileText,
  FlaskConical,
  GitBranch,
  Hammer,
  Slash,
  Terminal,
  User,
  UserCircle,
  X,
} from "lucide-solid";
import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";

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
  { id: "account", label: "Account", icon: UserCircle },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "mcp", label: "MCP", icon: Hammer },
  { id: "commands", label: "Commands", icon: Slash },
  { id: "agents", label: "Agents", icon: Brain },
  { id: "memory", label: "Memory", icon: ZapIcon },
  { id: "hooks", label: "Hooks", icon: Cloud },
  { id: "providers", label: "Providers", icon: FlaskConical },
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
    <nav class="flex flex-col gap-1 py-2">
      <For each={props.tabs}>
        {tab => {
          const isActive = () => props.activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              type="button"
              class={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-150",
                isActive()
                  ? "bg-muted/80 text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
              onClick={() => {
                if (tab.external && tab.href) {
                  window.open(tab.href, "_blank", "noopener,noreferrer");
                } else {
                  props.onTabChange(tab.id);
                }
              }}
            >
              <Icon class="size-4 shrink-0" />
              <span class="flex-1 text-left">{tab.label}</span>
              <Show when={tab.external}>
                <ExternalLink class="size-3.5 opacity-50" />
              </Show>
            </button>
          );
        }}
      </For>
    </nav>
  );
}

import { AccountSettings } from "./account-settings";
import { AgentsSettings } from "./agents-settings";
import { CommandsSettings } from "./commands-settings";
import { ExperimentalSettings } from "./experimental-settings";
import { GeneralSettings } from "./general-settings";
import { GitSettings } from "./git-settings";
import { HooksSettings } from "./hooks-settings";
import { McpSettings } from "./mcp-settings";
import { MemorySettings } from "./memory-settings";
import { ProvidersSettings } from "./providers-settings";
import { TerminalSettings } from "./terminal-settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [activeTab, setActiveTab] = createSignal("general");

  const activeTabContent = () => {
    switch (activeTab()) {
      case "general":
        return <GeneralSettings />;
      case "account":
        return <AccountSettings />;
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
      case "providers":
        return <ProvidersSettings />;
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
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          class="fixed inset-0 bg-black/80 backdrop-blur-sm"
          onClick={() => props.onOpenChange(false)}
        />

        <div class="dialog-overlay-motion border-border/80 bg-popover/95 relative z-10 flex h-[600px] w-full max-w-4xl overflow-hidden rounded-xl border shadow-2xl">
          <div class="border-border/80 bg-muted/30 w-56 shrink-0 border-r">
            <DialogSidebar
              tabs={SETTINGS_TABS}
              activeTab={activeTab()}
              onTabChange={setActiveTab}
            />
          </div>

          <div class="flex flex-1 flex-col overflow-hidden">
            <div class="border-border/80 flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 class="text-lg font-semibold tracking-tight">
                  {SETTINGS_TABS.find(t => t.id === activeTab())?.label}
                </h2>
                <p class="text-muted-foreground text-sm">
                  {activeTab() === "general"
                    ? "Configure your Conductor preferences"
                    : `Configure ${activeTab()} settings`}
                </p>
              </div>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
                onClick={() => props.onOpenChange(false)}
              >
                <X class="size-4" />
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-6">
              <div class="scrollbar-thin max-h-full overflow-y-auto pr-2">{activeTabContent()}</div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
