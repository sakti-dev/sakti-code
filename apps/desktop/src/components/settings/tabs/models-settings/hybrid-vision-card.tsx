import { Show } from "solid-js";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

interface HybridVisionCardProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function HybridVisionCard(props: HybridVisionCardProps) {
  return (
    <Card class="mt-4 p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 class="font-semibold text-sm tracking-tight">
            Hybrid Vision Fallback
          </h3>
          <p class="mt-0.5 text-muted-foreground text-xs">
            Auto-route image prompts from text-only models to a vision-capable
            model.
          </p>
        </div>
        <label class="flex items-center gap-2 text-xs">
          <input
            checked={props.enabled}
            onChange={(event) => props.onToggle(event.currentTarget.checked)}
            type="checkbox"
          />
          Enabled
        </label>
      </div>

      <p class="mb-1 block text-muted-foreground text-xs">
        Vision fallback model
      </p>
      <div class="flex items-center gap-2">
        <button
          class={cn(
            "w-full rounded-md border border-border/80 bg-background/70 px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/60",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
          disabled={true}
          type="button"
        >
          Select vision model
        </button>
      </div>

      <Show when={props.enabled}>
        <p class="mt-2 text-primary/85 text-xs">
          Hybrid fallback is enabled but no vision model is selected yet.
        </p>
      </Show>
    </Card>
  );
}
