import { For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useStore } from "~/stores/store-context";

const THINKING_LEVELS = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
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
          <span class="text-muted-foreground">Thinking:</span>
          {currentLabel()}
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-32">
          <For each={THINKING_LEVELS}>
            {(level) => (
              <DropdownMenuItem
                class={
                  activeSession()?.thinkingLevel === level.value
                    ? "bg-accent text-accent-foreground"
                    : ""
                }
                onSelect={() => handleSelect(level.value)}
              >
                {level.label}
              </DropdownMenuItem>
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenu.Root>
    </Show>
  );
}
