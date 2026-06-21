import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";

interface SessionStatsData {
  activeMessageCount: number;
  createdAt: number;
  durationMs: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

function formatTokens(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  if (count < 1_000_000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatCost(cost: number): string {
  if (cost === 0) {
    return "$0.00";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(2)}`;
  }
  return `$${cost.toFixed(2)}`;
}

const TOKEN_ROWS: {
  label: string;
  key: keyof Pick<SessionStatsData, "totalInputTokens" | "totalOutputTokens">;
}[] = [
  { label: "Input", key: "totalInputTokens" },
  { label: "Output", key: "totalOutputTokens" },
];

export default function SessionStats() {
  const { api, server } = useStore();
  const [isOpen, setIsOpen] = createSignal(false);
  // biome-ignore lint/suspicious/noUnassignedVariables: SolidJS ref binding
  let panelRef: HTMLDivElement | undefined;
  // biome-ignore lint/suspicious/noUnassignedVariables: SolidJS ref binding
  let triggerRef: HTMLButtonElement | undefined;

  const [stats, { refetch }] = createResource(
    () => server.store.activeSessionId,
    async (sessionId) => {
      const { data, error } = await api.api
        .sessions({ id: sessionId })
        .stats.get();
      if (error || !data) {
        return null;
      }
      return data as SessionStatsData;
    }
  );

  const isConnected = () => server.store.connection.status === "open";
  const hasSession = () => server.store.activeSessionId !== null;

  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (
      panelRef &&
      !panelRef.contains(target) &&
      triggerRef &&
      !triggerRef.contains(target)
    ) {
      setIsOpen(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      triggerRef?.focus();
    }
  };

  createEffect(() => {
    if (isOpen()) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      onCleanup(() => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      });
    }
  });

  if (!(isConnected() && hasSession())) {
    return null;
  }

  const currentStats = stats();
  if (!currentStats) {
    return null;
  }

  return (
    <div class="relative">
      <button
        class={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] tabular-nums transition-colors",
          "text-muted-foreground hover:bg-secondary hover:text-foreground",
          isOpen() && "bg-secondary text-foreground"
        )}
        onClick={() => setIsOpen((prev) => !prev)}
        ref={triggerRef}
        title="Session stats"
        type="button"
      >
        <svg
          aria-label="Token usage"
          class="h-3 w-3 shrink-0"
          fill="currentColor"
          role="img"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Token usage</title>
          <path d="M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8zm7-5.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM7.25 4.5a.75.75 0 0 1 1.5 0V5h.5a.75.75 0 0 1 0 1.5H7.5a.5.5 0 0 0 0 1h1a2 2 0 1 1 0 4h-.25v.5a.75.75 0 0 1-1.5 0V11.5h-.5a.75.75 0 0 1 0-1.5h1.75a.5.5 0 0 0 0-1h-1a2 2 0 1 1 0-4h.25v-.5z" />
        </svg>
        <span>
          {formatTokens(
            currentStats.totalInputTokens + currentStats.totalOutputTokens
          )}
        </span>
        <span class="text-muted-foreground">·</span>
        <span>{formatCost(currentStats.totalCostUsd)}</span>
      </button>

      <Show when={isOpen()}>
        <div
          class={cn(
            "absolute top-full right-0 z-50 mt-1 w-56",
            "rounded-lg border border-border bg-popover shadow-xl"
          )}
          ref={panelRef}
        >
          <div class="flex items-center justify-between border-border border-b px-3 py-2">
            <span class="font-medium text-foreground text-xs">
              Session Stats
            </span>
            <button
              class="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => refetch()}
              title="Refresh stats"
              type="button"
            >
              <svg
                aria-label="Refresh"
                class="h-3.5 w-3.5"
                fill="currentColor"
                role="img"
                viewBox="0 0 16 16"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>Refresh</title>
                <path
                  clip-rule="evenodd"
                  d="M3.083 5.802a5 5 0 0 1 8.92-.798.75.75 0 1 0 1.37-.61 6.5 6.5 0 0 0-11.595 1.036L1 4.75V7.5h2.75L3.083 5.802zM12.917 10.198a5 5 0 0 1-8.92.798.75.75 0 0 0-1.37.61 6.5 6.5 0 0 0 11.595-1.036L15 11.25V8.5h-2.75l.667 1.698z"
                />
              </svg>
            </button>
          </div>

          <div class="space-y-3 p-3">
            <div>
              <div class="mb-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                Tokens
              </div>
              <div class="space-y-1 text-xs">
                <For each={TOKEN_ROWS}>
                  {(row) => (
                    <div class="flex items-center justify-between gap-4">
                      <span class="text-muted-foreground">{row.label}</span>
                      <span class="text-foreground tabular-nums">
                        {formatTokens(currentStats[row.key])}
                      </span>
                    </div>
                  )}
                </For>
                <div class="flex items-center justify-between gap-4 border-border border-t pt-1 font-medium">
                  <span class="text-foreground">Total</span>
                  <span class="text-foreground tabular-nums">
                    {formatTokens(
                      currentStats.totalInputTokens +
                        currentStats.totalOutputTokens
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div class="mb-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                Messages
              </div>
              <div class="space-y-1 text-xs">
                <div class="flex items-center justify-between gap-4">
                  <span class="text-muted-foreground">Active</span>
                  <span class="text-foreground tabular-nums">
                    {currentStats.activeMessageCount}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div class="mb-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                Cost
              </div>
              <div class="font-medium text-foreground text-sm tabular-nums">
                {formatCost(currentStats.totalCostUsd)}
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
