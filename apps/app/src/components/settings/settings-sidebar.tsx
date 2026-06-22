import {
  BiRegularBox,
  BiRegularCloud,
  BiRegularCommand,
  BiRegularFile,
  BiRegularGitBranch,
  BiRegularTerminal,
  BiRegularUser,
  BiRegularWrench,
} from "solid-icons/bi";
import { FaRegularLightbulb, FaRegularStar } from "solid-icons/fa";
import { FiBook, FiExternalLink, FiZap } from "solid-icons/fi";
import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { cn } from "~/lib/utils";

export interface SettingsTab {
  external?: boolean;
  href?: string;
  icon: Component<{ class?: string }>;
  id: string;
  label: string;
}

export const SETTINGS_TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: BiRegularUser },
  { id: "models", label: "Models", icon: BiRegularBox },
  { id: "git", label: "Git", icon: BiRegularGitBranch },
  { id: "terminal", label: "Terminal", icon: BiRegularTerminal },
  { id: "mcp", label: "MCP", icon: BiRegularWrench },
  { id: "commands", label: "Commands", icon: BiRegularCommand },
  { id: "agents", label: "Agents", icon: FaRegularLightbulb },
  { id: "memory", label: "Memory", icon: FiZap },
  { id: "hooks", label: "Hooks", icon: BiRegularCloud },
  { id: "experimental", label: "Experimental", icon: BiRegularFile },
  {
    id: "changelog",
    label: "Changelog",
    icon: FiBook,
    external: true,
    href: "https://github.com",
  },
  {
    id: "docs",
    label: "Docs",
    icon: FaRegularStar,
    external: true,
    href: "https://docs.sakti-code.dev",
  },
];

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function SettingsSidebar(props: SettingsSidebarProps) {
  return (
    <div class="flex flex-col gap-1 px-2 py-2">
      <For each={SETTINGS_TABS}>
        {(tab) => {
          const isActive = () => props.activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              class={cn(
                "group w-full rounded-md border px-2.5 py-2 text-left transition-all duration-120",
                isActive()
                  ? "border-primary/45 bg-accent/70 shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_45%,transparent),0_8px_24px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]"
                  : "border-transparent hover:border-border/90 hover:bg-muted/70"
              )}
              onClick={() => {
                if (tab.external && tab.href) {
                  window.open(tab.href, "_blank", "noopener,noreferrer");
                } else {
                  props.onTabChange(tab.id);
                }
              }}
              type="button"
            >
              <div class="flex items-center gap-3">
                <Icon
                  class={cn(
                    "size-4 shrink-0",
                    isActive() ? "text-foreground" : "text-muted-foreground"
                  )}
                />
                <span class="truncate font-medium text-sm">{tab.label}</span>
              </div>
              <Show when={tab.external}>
                <FiExternalLink class="size-3.5 shrink-0 opacity-50" />
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
}
