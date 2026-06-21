import { For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";

const THINKING_LEVELS = [
  {
    value: "off",
    label: "Off",
    description: "No reasoning — fastest, cheapest",
  },
  { value: "minimal", label: "Minimal", description: "Very brief reasoning" },
  {
    value: "low",
    label: "Low",
    description: "Light reasoning for simple tasks",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced reasoning (default)",
  },
  {
    value: "high",
    label: "High",
    description: "Deep reasoning for complex tasks",
  },
  {
    value: "xhigh",
    label: "Extra High",
    description: "Maximum reasoning depth",
  },
] as const;

export default function ThinkingSelector() {
  const { server } = useStore();

  const activeSession = () => {
    const id = server.store.activeSessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const currentLabel = () => {
    const level = activeSession()?.thinkingLevel;
    return THINKING_LEVELS.find((l) => l.value === level)?.label ?? "Off";
  };

  const handleSelect = (level: string) => {
    const session = activeSession();
    if (!session) {
      return;
    }
    server.actions.updateSession(session.id, { thinkingLevel: level });
  };

  return (
    <Show when={activeSession()}>
      <DropdownMenu.Root>
        <DropdownMenuTrigger<typeof Button>
          as={Button}
          class="h-7 gap-1.5 text-xs"
          size="sm"
          variant="ghost"
        >
          <svg
            aria-label="Thinking level"
            class="h-3.5 w-3.5 shrink-0"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Thinking level</title>
            <path d="M10 3.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V4H4.5A1.5 1.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 4H10v-.5zM7 4h2v-.5H7V4zm-2.5 1h7a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .5-.5z" />
            <path d="M5.5 7a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1H6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1H6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H6a.5.5 0 0 1-.5-.5z" />
          </svg>
          {currentLabel()}
          <svg
            aria-label="Toggle thinking level list"
            class="h-3 w-3 shrink-0"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Toggle thinking level list</title>
            <path
              clip-rule="evenodd"
              d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z"
            />
          </svg>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-64">
          <div class="border-border border-b px-3 py-2">
            <span class="font-medium text-foreground text-xs">
              Thinking Level
            </span>
          </div>
          <div class="py-1">
            <For each={THINKING_LEVELS}>
              {(level) => {
                const isActive = () =>
                  activeSession()?.thinkingLevel === level.value;
                const levelIndex = THINKING_LEVELS.findIndex(
                  (l) => l.value === level.value
                );
                return (
                  <DropdownMenuItem
                    class={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                      isActive()
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-secondary"
                    )}
                    onSelect={() => handleSelect(level.value)}
                  >
                    <span
                      class={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        isActive() ? "bg-accent-foreground" : "bg-transparent"
                      )}
                    />
                    <div class="min-w-0 flex-1">
                      <div class="font-medium text-xs">{level.label}</div>
                      <div class="mt-0.5 text-[10px] text-muted-foreground">
                        {level.description}
                      </div>
                    </div>
                    <div class="flex shrink-0 gap-0.5">
                      <For each={THINKING_LEVELS}>
                        {(_, i) => {
                          const filled = () => i() <= levelIndex;
                          const barColor = () => {
                            if (!filled()) {
                              return "bg-secondary";
                            }
                            return isActive()
                              ? "bg-accent-foreground"
                              : "bg-muted-foreground";
                          };
                          return (
                            <div class={cn("h-2 w-1 rounded-sm", barColor())} />
                          );
                        }}
                      </For>
                    </div>
                  </DropdownMenuItem>
                );
              }}
            </For>
          </div>
        </DropdownMenuContent>
      </DropdownMenu.Root>
    </Show>
  );
}
