import { Show, type JSX } from "solid-js";

interface IntakeCardProps {
  title: string | null;
  updatedAt: number;
  hasPendingAsk: boolean;
  onClick: () => void;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function IntakeCard(props: IntakeCardProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => props.onClick()}
      class="flex min-h-[68px] flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-3.5 text-left transition-colors hover:border-primary/30 hover:bg-accent/50"
    >
      <span class="line-clamp-1 font-medium text-sm">{props.title ?? "Untitled intake"}</span>
      <span class="flex items-center gap-1.5 text-muted-foreground text-xs">
        <Show when={props.hasPendingAsk} fallback={<span>{formatRelative(props.updatedAt)}</span>}>
          <span class="intake-pending-dot inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          <span>waiting for you</span>
        </Show>
      </span>
    </button>
  );
}
