import { FiEye } from "solid-icons/fi";
import { TbOutlineChevronRight } from "solid-icons/tb";
import { createMemo, createSignal, Show } from "solid-js";
import { cn } from "~/lib/utils/index.ts";
import type { OmWindowState } from "~/stores/types.ts";
import { OmProgressBars } from "./om-progress-bars.tsx";

function thinBarColor(percentage: number): string {
  if (percentage >= 85) return "bg-warning";
  if (percentage >= 60) return "bg-info";
  return "bg-success";
}

export function MemorySidebarCard(props: { omStatus: OmWindowState | null }) {
  const [expanded, setExpanded] = createSignal(false);
  const messagePercent = createMemo(() =>
    props.omStatus
      ? Math.min(
          100,
          Math.round((props.omStatus.messages.tokens / props.omStatus.messages.threshold) * 100),
        )
      : 0,
  );

  return (
    <div class="border-border/50 border-t" data-component="memory-sidebar-card">
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30"
        onClick={() => setExpanded(!expanded())}
      >
        <TbOutlineChevronRight
          class={cn("h-3 w-3 transition-transform", expanded() && "rotate-90")}
        />
        <FiEye class="h-3.5 w-3.5" />
        <span class="flex-1 font-medium">Memory</span>
        <Show when={props.omStatus}>
          <span class="tabular-nums text-muted-foreground/70">{messagePercent()}%</span>
        </Show>
      </button>

      <Show when={!expanded() && props.omStatus}>
        <div class="h-1 w-full overflow-hidden bg-muted/30" data-slot="thin-bar">
          <div
            class={cn("h-full transition-all duration-300", thinBarColor(messagePercent()))}
            style={{ width: `${messagePercent()}%` }}
          />
        </div>
      </Show>

      <Show when={expanded() && props.omStatus}>
        <div class="px-3 pb-3">
          <OmProgressBars
            messages={props.omStatus!.messages}
            observations={props.omStatus!.observations}
          />
        </div>
      </Show>
    </div>
  );
}
