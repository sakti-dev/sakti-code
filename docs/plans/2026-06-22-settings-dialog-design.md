# Settings Dialog Recreation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Recreate the old settings dialog with sidebar navigation, full Models tab with OAuth, and placeholder tabs.

**Architecture:** Split into `settings-dialog.tsx` (layout), `settings-sidebar.tsx` (navigation), and individual tab components under `tabs/`. Models tab merges current API Keys functionality with full provider connection flow (API key + OAuth). All tabs use SolidJS patterns and existing UI components.

**Tech Stack:** SolidJS, solid-icons, Kobalte (useColorMode), existing UI components (Dialog, Button, Switch, Select, ScrollArea)

---

### Task 1: Create directory structure and settings dialog shell

**Files:**
- Create: `apps/app/src/components/settings/settings-dialog.tsx`
- Create: `apps/app/src/components/settings/settings-sidebar.tsx`

**Step 1: Create settings dialog shell**

```tsx
// apps/app/src/components/settings/settings-dialog.tsx
import { createSignal, Show } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { SettingsSidebar, SETTINGS_TABS } from "./settings-sidebar";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [activeTab, setActiveTab] = createSignal("general");

  const activeTabLabel = () =>
    SETTINGS_TABS.find((t) => t.id === activeTab())?.label ?? "Settings";

  const activeTabDescription = () => {
    if (activeTab() === "general") return "Configure your preferences";
    return `Configure ${activeTab()} settings`;
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
              {/* Tab content will be added in subsequent tasks */}
              <div class="py-8 text-center text-muted-foreground text-sm">
                {activeTabLabel()} settings
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Create settings sidebar**

```tsx
// apps/app/src/components/settings/settings-sidebar.tsx
import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import {
  BiRegularBox,
  BiRegularCommand,
  BiRegularCloud,
  BiRegularFile,
  BiRegularGitBranch,
  BiRegularTerminal,
  BiRegularTool,
  BiRegularUser,
  BiRegularZap,
} from "solid-icons/bi";
import { FiBook, FiExternalLink } from "solid-icons/fi";
import { FaRegularLightbulb, FaRegularStar } from "solid-icons/fa";
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
  { id: "mcp", label: "MCP", icon: BiRegularTool },
  { id: "commands", label: "Commands", icon: BiRegularCommand },
  { id: "agents", label: "Agents", icon: FaRegularLightbulb },
  { id: "memory", label: "Memory", icon: BiRegularZap },
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
```

**Step 3: Verify typecheck passes**

Run: `cd apps/app && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/app/src/components/settings/
git commit -m "feat(settings): add settings dialog shell with sidebar navigation"
```

---

### Task 2: Create placeholder tabs

**Files:**
- Create: `apps/app/src/components/settings/tabs/git-settings.tsx`
- Create: `apps/app/src/components/settings/tabs/terminal-settings.tsx`
- Create: `apps/app/src/components/settings/tabs/mcp-settings.tsx`
- Create: `apps/app/src/components/settings/tabs/commands-settings.tsx`
- Create: `apps/app/src/components/settings/tabs/agents-settings.tsx`
- Create: `apps/app/src/components/settings/tabs/memory-settings.tsx`
- Create: `apps/app/src/components/settings/tabs/hooks-settings.tsx`
- Create: `apps/app/src/components/settings/tabs/experimental-settings.tsx`

**Step 1: Create all placeholder tabs**

```tsx
// apps/app/src/components/settings/tabs/git-settings.tsx
export function GitSettings() {
  return (
    <div class="border-border/70 px-0 py-8 text-center">
      <p class="text-muted-foreground text-sm">Git settings coming soon</p>
    </div>
  );
}
```

```tsx
// apps/app/src/components/settings/tabs/terminal-settings.tsx
export function TerminalSettings() {
  return (
    <div class="border-border/70 px-0 py-8 text-center">
      <p class="text-muted-foreground text-sm">Terminal settings coming soon</p>
    </div>
  );
}
```

```tsx
// apps/app/src/components/settings/tabs/mcp-settings.tsx
export function McpSettings() {
  return (
    <div class="border-border/70 px-0 py-8 text-center">
      <p class="text-muted-foreground text-sm">MCP settings coming soon</p>
    </div>
  );
}
```

```tsx
// apps/app/src/components/settings/tabs/commands-settings.tsx
export function CommandsSettings() {
  return (
    <div class="border-border/70 px-0 py-8 text-center">
      <p class="text-muted-foreground text-sm">Commands settings coming soon</p>
    </div>
  );
}
```

```tsx
// apps/app/src/components/settings/tabs/agents-settings.tsx
export function AgentsSettings() {
  return (
    <div class="border-border/70 px-0 py-8 text-center">
      <p class="text-muted-foreground text-sm">Agents settings coming soon</p>
    </div>
  );
}
```

```tsx
// apps/app/src/components/settings/tabs/memory-settings.tsx
export function MemorySettings() {
  return (
    <div class="border-border/70 px-0 py-8 text-center">
      <p class="text-muted-foreground text-sm">Memory settings coming soon</p>
    </div>
  );
}
```

```tsx
// apps/app/src/components/settings/tabs/hooks-settings.tsx
export function HooksSettings() {
  return (
    <div class="border-border/70 px-0 py-8 text-center">
      <p class="text-muted-foreground text-sm">Hooks settings coming soon</p>
    </div>
  );
}
```

```tsx
// apps/app/src/components/settings/tabs/experimental-settings.tsx
export function ExperimentalSettings() {
  return (
    <div class="border-border/70 px-0 py-8 text-center">
      <p class="text-muted-foreground text-sm">
        Experimental settings coming soon
      </p>
    </div>
  );
}
```

**Step 2: Verify typecheck passes**

Run: `cd apps/app && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/app/src/components/settings/tabs/
git commit -m "feat(settings): add placeholder tabs"
```

---

### Task 3: Create general settings tab

**Files:**
- Create: `apps/app/src/components/settings/tabs/general-settings.tsx`

**Step 1: Create general settings with theme selector**

```tsx
// apps/app/src/components/settings/tabs/general-settings.tsx
import { useColorMode } from "@kobalte/core";
import { createSignal, For } from "solid-js";
import { cn } from "~/lib/utils";

type ThemeChoice = "light" | "dark" | "system";

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function CheckIcon() {
  return (
    <svg
      aria-label="Selected"
      class="ml-auto h-4 w-4 shrink-0 text-foreground"
      fill="currentColor"
      role="img"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Selected</title>
      <path
        clip-rule="evenodd"
        d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207z"
      />
    </svg>
  );
}

export function GeneralSettings() {
  const { colorMode, setColorMode } = useColorMode();

  const currentChoice = (): ThemeChoice => {
    const stored = localStorage.getItem("sakti-theme");
    if (stored === '"system"' || stored === "system") {
      return "system";
    }
    return colorMode() as ThemeChoice;
  };

  const handleSelectTheme = (choice: ThemeChoice) => {
    if (choice === "system") {
      localStorage.setItem("sakti-theme", '"system"');
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      setColorMode(prefersDark ? "dark" : "light");
    } else {
      localStorage.setItem("sakti-theme", `"${choice}"`);
      setColorMode(choice);
    }
  };

  return (
    <div class="space-y-0">
      <div class="flex items-center justify-between border-border/70 border-b px-0 py-4">
        <div class="flex-1">
          <p class="font-medium text-foreground text-sm">Theme</p>
          <p class="text-muted-foreground text-xs">Toggle with Ctrl+Shift+T</p>
        </div>
        <div class="ml-6 w-40">
          <div class="flex flex-col gap-1.5">
            <For each={THEME_OPTIONS}>
              {(opt) => (
                <button
                  class={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2 transition-all",
                    currentChoice() === opt.value
                      ? "border-primary bg-secondary"
                      : "border-border hover:border-muted-foreground hover:bg-secondary"
                  )}
                  onClick={() => handleSelectTheme(opt.value)}
                  type="button"
                >
                  <span
                    class={cn(
                      "font-medium text-xs",
                      currentChoice() === opt.value
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {opt.label}
                  </span>
                  {currentChoice() === opt.value && <CheckIcon />}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between border-border/70 border-b px-0 py-4">
        <div class="flex-1">
          <p class="font-medium text-foreground text-sm">Session notifications</p>
          <p class="text-muted-foreground text-xs">
            Get notified when AI finishes working in a session.
          </p>
        </div>
        <div class="ml-6">
          <span class="text-muted-foreground text-xs">Coming soon</span>
        </div>
      </div>

      <div class="flex items-center justify-between border-border/70 border-b px-0 py-4">
        <div class="flex-1">
          <p class="font-medium text-foreground text-sm">
            Completion sound effects
          </p>
          <p class="text-muted-foreground text-xs">
            Play a sound when AI finishes working in a session.
          </p>
        </div>
        <div class="ml-6">
          <span class="text-muted-foreground text-xs">Coming soon</span>
        </div>
      </div>

      <div class="flex items-center justify-between border-border/70 border-b px-0 py-4">
        <div class="flex-1">
          <p class="font-medium text-foreground text-sm">
            Strip confirmation messages
          </p>
          <p class="text-muted-foreground text-xs">
            Strip "You're absolutely right!" from AI messages
          </p>
        </div>
        <div class="ml-6">
          <span class="text-muted-foreground text-xs">Coming soon</span>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify typecheck passes**

Run: `cd apps/app && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/app/src/components/settings/tabs/general-settings.tsx
git commit -m "feat(settings): add general settings tab with theme selector"
```

---

### Task 4: Create models settings tab with API key management

**Files:**
- Create: `apps/app/src/components/settings/tabs/models-settings.tsx`
- Modify: `apps/app/src/components/settings/settings-dialog.tsx:1-50` (add tab content routing)

**Step 1: Create models settings with provider list and API key input**

```tsx
// apps/app/src/components/settings/tabs/models-settings.tsx
import { createResource, createSignal, For, Show } from "solid-js";
import { cn } from "~/lib/utils";

interface ApiKeyInfo {
  envVar: string;
  hasKey: boolean;
  maskedKey: string | null;
  provider: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  cerebras: "Cerebras",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  google: "Google (Gemini)",
  groq: "Groq",
  huggingface: "Hugging Face",
  mistral: "Mistral",
  openai: "OpenAI",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  together: "Together",
  xai: "xAI",
  zai: "ZAI",
};

function StatusDot(props: { hasKey: boolean }) {
  return (
    <span
      class={cn(
        "h-2 w-2 shrink-0 rounded-full",
        props.hasKey ? "bg-green-500" : "bg-muted-foreground/30"
      )}
      title={props.hasKey ? "Key set" : "No key"}
    />
  );
}

const ApiKeyRow: Component<{
  apiKey: ApiKeyInfo;
  onSave: (provider: string, key: string) => Promise<void>;
  onDelete: (provider: string) => Promise<void>;
}> = (props) => {
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  const label = () =>
    PROVIDER_LABELS[props.apiKey.provider] ?? props.apiKey.provider;

  const handleSave = async () => {
    const key = value().trim();
    if (!key) return;
    setSaving(true);
    try {
      await props.onSave(props.apiKey.provider, key);
      setValue("");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await props.onDelete(props.apiKey.provider);
    setEditing(false);
  };

  return (
    <div class="flex items-center gap-2 py-1.5">
      <StatusDot hasKey={props.apiKey.hasKey} />
      <div class="min-w-0 flex-1">
        <span class="font-medium text-foreground text-xs">{label()}</span>
        <Show when={props.apiKey.maskedKey}>
          <span class="ml-2 text-[10px] text-muted-foreground/70 tabular-nums">
            {props.apiKey.maskedKey}
          </span>
        </Show>
      </div>
      <Show
        fallback={
          <div class="flex items-center gap-1">
            <Show when={props.apiKey.hasKey}>
              <button
                class="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={handleDelete}
                title="Remove key"
                type="button"
              >
                Remove
              </button>
            </Show>
            <button
              class="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onClick={() => setEditing(true)}
              type="button"
            >
              {props.apiKey.hasKey ? "Update" : "Add key"}
            </button>
          </div>
        }
        when={editing()}
      >
        <div class="flex items-center gap-1">
          <input
            autocomplete="off"
            class="w-48 rounded border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
            onInput={(e) => setValue(e.currentTarget.value)}
            placeholder={props.apiKey.envVar}
            spellcheck={false}
            type="password"
            value={value()}
          />
          <button
            class="rounded bg-primary px-2 py-1 font-medium text-[11px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            disabled={!value().trim() || saving()}
            onClick={handleSave}
            type="button"
          >
            {saving() ? "Saving..." : "Save"}
          </button>
          <button
            class="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => {
              setValue("");
              setEditing(false);
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      </Show>
    </div>
  );
};

export function ModelsSettings() {
  const [keys, { refetch }] = createResource(async () => {
    const res = await fetch("/api/api-keys/");
    if (!res.ok) return [] as ApiKeyInfo[];
    return (await res.json()) as ApiKeyInfo[];
  });

  const handleSaveKey = async (provider: string, key: string) => {
    await fetch(`/api/api-keys/${provider}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    refetch();
  };

  const handleDeleteKey = async (provider: string) => {
    await fetch(`/api/api-keys/${provider}`, { method: "DELETE" });
    refetch();
  };

  const hasAnyKey = () => keys()?.some((k) => k.hasKey) ?? false;

  return (
    <div class="space-y-4">
      <div class="rounded-lg border border-border p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-semibold text-foreground text-sm">Providers</h3>
          <Show
            fallback={
              <span class="text-[10px] text-yellow-500">No keys configured</span>
            }
            when={hasAnyKey()}
          >
            <span class="text-[10px] text-green-500">
              {keys()?.filter((k) => k.hasKey).length} provider(s) active
            </span>
          </Show>
        </div>
        <p class="mb-3 text-muted-foreground text-xs">
          Keys are stored locally at{" "}
          <code class="rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">
            ~/.config/sakti-code/api-keys.json
          </code>
        </p>
        <div class="rounded-lg border border-border p-3">
          <For each={keys() ?? []}>
            {(keyInfo) => (
              <ApiKeyRow
                apiKey={keyInfo}
                onDelete={handleDeleteKey}
                onSave={handleSaveKey}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update settings dialog to route tab content**

```tsx
// apps/app/src/components/settings/settings-dialog.tsx
import { createSignal, Show } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { SettingsSidebar, SETTINGS_TABS } from "./settings-sidebar";
import { GeneralSettings } from "./tabs/general-settings";
import { ModelsSettings } from "./tabs/models-settings";
import { GitSettings } from "./tabs/git-settings";
import { TerminalSettings } from "./tabs/terminal-settings";
import { McpSettings } from "./tabs/mcp-settings";
import { CommandsSettings } from "./tabs/commands-settings";
import { AgentsSettings } from "./tabs/agents-settings";
import { MemorySettings } from "./tabs/memory-settings";
import { HooksSettings } from "./tabs/hooks-settings";
import { ExperimentalSettings } from "./tabs/experimental-settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [activeTab, setActiveTab] = createSignal("general");

  const activeTabLabel = () =>
    SETTINGS_TABS.find((t) => t.id === activeTab())?.label ?? "Settings";

  const activeTabDescription = () => {
    if (activeTab() === "general") return "Configure your preferences";
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
```

**Step 3: Verify typecheck passes**

Run: `cd apps/app && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/app/src/components/settings/
git commit -m "feat(settings): add models settings tab with API key management"
```

---

### Task 5: Update home page to use new settings dialog

**Files:**
- Modify: `apps/app/src/pages/home.tsx:1-50` (update import)

**Step 1: Update import in home page**

```tsx
// apps/app/src/pages/home.tsx
// Change this line:
import SettingsDialog from "~/components/toolbar/settings-dialog";

// To this:
import { SettingsDialog } from "~/components/settings/settings-dialog";
```

**Step 2: Update SettingsDialog usage**

```tsx
// Find the SettingsDialog usage and update props:
<SettingsDialog open={showSettings()} onOpenChange={setShowSettings} />
```

**Step 3: Verify typecheck passes**

Run: `cd apps/app && npx tsc --noEmit`
Expected: PASS

**Step 4: Run tests**

Run: `cd apps/app && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/pages/home.tsx
git commit -m "feat(settings): update home page to use new settings dialog"
```

---

### Task 6: Clean up old settings dialog

**Files:**
- Delete: `apps/app/src/components/toolbar/settings-dialog.tsx`

**Step 1: Delete old settings dialog**

Run: `rm apps/app/src/components/toolbar/settings-dialog.tsx`

**Step 2: Verify no remaining imports**

Run: `grep -r "settings-dialog" apps/app/src/`
Expected: Only new settings directory

**Step 3: Verify typecheck passes**

Run: `cd apps/app && npx tsc --noEmit`
Expected: PASS

**Step 4: Run full test suite**

Run: `cd apps/app && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): remove old settings dialog"
```

---

### Task 7: Final verification

**Step 1: Run typecheck**

Run: `cd apps/app && npx tsc --noEmit`
Expected: PASS

**Step 2: Run lint**

Run: `bun x ultracite fix`
Expected: PASS

**Step 3: Run tests**

Run: `cd apps/app && npx vitest run`
Expected: PASS

**Step 4: Manual verification**

1. Open the app
2. Click Settings button on home page
3. Verify sidebar navigation works
4. Verify all tabs render
5. Verify theme selector works
6. Verify API key management works

---

## Summary

**Files Created:**
- `apps/app/src/components/settings/settings-dialog.tsx`
- `apps/app/src/components/settings/settings-sidebar.tsx`
- `apps/app/src/components/settings/tabs/general-settings.tsx`
- `apps/app/src/components/settings/tabs/models-settings.tsx`
- `apps/app/src/components/settings/tabs/git-settings.tsx`
- `apps/app/src/components/settings/tabs/terminal-settings.tsx`
- `apps/app/src/components/settings/tabs/mcp-settings.tsx`
- `apps/app/src/components/settings/tabs/commands-settings.tsx`
- `apps/app/src/components/settings/tabs/agents-settings.tsx`
- `apps/app/src/components/settings/tabs/memory-settings.tsx`
- `apps/app/src/components/settings/tabs/hooks-settings.tsx`
- `apps/app/src/components/settings/tabs/experimental-settings.tsx`

**Files Modified:**
- `apps/app/src/pages/home.tsx` (updated import)

**Files Deleted:**
- `apps/app/src/components/toolbar/settings-dialog.tsx`

**Commits:**
1. `feat(settings): add settings dialog shell with sidebar navigation`
2. `feat(settings): add placeholder tabs`
3. `feat(settings): add general settings tab with theme selector`
4. `feat(settings): add models settings tab with API key management`
5. `feat(settings): update home page to use new settings dialog`
6. `feat(settings): remove old settings dialog`
