import type { JSX } from "solid-js";

interface IntakeCardProps {
  title: string | null;
  updatedAt: number;
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
      class="flex min-h-[88px] flex-col gap-1 rounded-lg border border-border/60 bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
      onClick={() => props.onClick()}
      type="button"
    >
      <span class="line-clamp-1 font-medium text-sm">{props.title ?? "Untitled intake"}</span>
      <span class="text-muted-foreground text-xs">{formatRelative(props.updatedAt)}</span>
    </button>
  );
}
