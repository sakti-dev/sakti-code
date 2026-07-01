import { FiAlertTriangle, FiChevronDown, FiEye, FiLoader, FiXCircle } from "solid-icons/fi";
import { type Component, createMemo, createSignal, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "~/lib/utils/index.ts";
import type { MessagePart } from "~/stores/types.ts";
import type { PartProps } from "./part-registry.ts";
import { ObservationRenderer } from "./observation-renderer.tsx";

type OmMarker = Extract<MessagePart, { type: "om_marker" }>;

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

function compressionRatio(processed?: number, produced?: number): number | undefined {
  if (!processed || !produced || produced >= processed) return undefined;
  return Math.round(processed / produced);
}

interface StatusStyle {
  bg: string;
  icon: Component<{ class?: string }>;
  spin: boolean;
}

const STATUS_STYLES: Record<OmMarker["status"], StatusStyle> = {
  loading: { bg: "bg-info/10 text-info", icon: FiLoader, spin: true },
  complete: { bg: "bg-success/10 text-success", icon: FiEye, spin: false },
  failed: { bg: "bg-destructive/10 text-destructive", icon: FiXCircle, spin: false },
  buffering: {
    bg: "bg-accent/10 text-accent-foreground border border-dashed border-accent/30",
    icon: FiLoader,
    spin: true,
  },
  "buffering-complete": {
    bg: "bg-accent/10 text-accent-foreground border border-dashed border-accent/30",
    icon: FiEye,
    spin: false,
  },
  "buffering-failed": {
    bg: "bg-destructive/10 text-destructive border border-dashed border-destructive/30",
    icon: FiXCircle,
    spin: false,
  },
  activated: { bg: "bg-success/10 text-success", icon: FiEye, spin: false },
  disconnected: { bg: "bg-warning/10 text-warning", icon: FiAlertTriangle, spin: false },
};

function statusLabel(part: OmMarker): string {
  const isReflection = part.operationType === "reflection";
  const actionVerb = isReflection ? "Reflecting" : "Observing";
  const doneVerb = isReflection ? "Reflected" : "Observed";

  switch (part.status) {
    case "loading":
      return `${actionVerb} ~${formatTokens(part.tokensProcessed ?? 0)} tokens...`;
    case "buffering":
      return `Buffering ~${formatTokens(part.tokensProcessed ?? 0)} tokens...`;
    case "complete":
    case "activated":
    case "buffering-complete": {
      const ratio = compressionRatio(part.tokensProcessed, part.tokensProduced);
      return `${doneVerb} ${formatTokens(part.tokensProcessed ?? 0)}\u2192${formatTokens(part.tokensProduced ?? 0)} tokens${ratio ? ` (-${ratio}x)` : ""}`;
    }
    case "failed":
    case "buffering-failed":
      return isReflection ? "Reflection failed" : "Observation failed";
    case "disconnected":
      return `${actionVerb} interrupted (~${formatTokens(part.tokensProcessed ?? 0)} tokens)`;
  }
}

export function OmMarkerPart(props: PartProps) {
  const [expanded, setExpanded] = createSignal(false);
  const part = createMemo(() => props.part as OmMarker);
  const style = () => STATUS_STYLES[part().status];
  const ratio = () => compressionRatio(part().tokensProcessed, part().tokensProduced);
  const hasDetail = () =>
    Boolean(part().observations || part().currentTask || part().suggestedResponse || part().error);

  return (
    <div
      class="mb-1"
      data-component="om-marker-part"
      data-om-cycle={part().cycleId}
      data-om-status={part().status}
    >
      <button
        class={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
          style().bg,
        )}
        onClick={() => hasDetail() && setExpanded(!expanded())}
      >
        <Dynamic
          component={style().icon}
          class={cn("h-3.5 w-3.5 shrink-0", style().spin && "animate-spin")}
        />
        <span class="min-w-0 flex-1 truncate">{statusLabel(part())}</span>
        <Show when={part().durationMs !== undefined}>
          <span class="shrink-0 text-muted-foreground/70 tabular-nums">
            {(part().durationMs! / 1000).toFixed(1)}s
          </span>
        </Show>
        <Show when={hasDetail()}>
          <FiChevronDown
            class={cn(
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
              expanded() && "rotate-180",
            )}
          />
        </Show>
      </button>

      <Show when={expanded() && hasDetail()}>
        <div class="mt-1 rounded-lg border border-border/50 bg-muted/30 p-3 text-sm">
          <Show when={part().tokensProcessed !== undefined}>
            <div class="mb-2 flex gap-4 text-xs text-muted-foreground">
              <span>Input: {formatTokens(part().tokensProcessed!)}</span>
              <Show when={part().tokensProduced !== undefined}>
                <span>Output: {formatTokens(part().tokensProduced!)}</span>
              </Show>
              <Show when={ratio() && ratio()! > 1}>
                <span>Compression: {ratio()}x</span>
              </Show>
              <Show when={part().durationMs !== undefined}>
                <span>Duration: {(part().durationMs! / 1000).toFixed(2)}s</span>
              </Show>
            </div>
          </Show>

          <Show when={part().error}>
            <div class="mb-2 rounded-md bg-destructive/5 p-2 text-destructive text-xs">
              {part().error}
            </div>
          </Show>

          <Show when={part().observations}>
            <ObservationRenderer text={part().observations!} />
          </Show>

          <Show when={part().currentTask}>
            <div class="mt-2 text-xs">
              <span class="font-medium text-muted-foreground">Current task: </span>
              {part().currentTask}
            </div>
          </Show>

          <Show when={part().suggestedResponse}>
            <div class="mt-1 text-xs italic text-muted-foreground">{part().suggestedResponse}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
