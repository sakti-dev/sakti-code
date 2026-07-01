import { cn } from "~/lib/utils/index.ts";

interface WindowData {
  threshold: number;
  tokens: number;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

function barColor(percentage: number): string {
  return percentage >= 60 ? "bg-info" : "bg-success";
}

function ProgressBar(props: { data: WindowData; label: string }) {
  const percentage = () =>
    Math.min(100, Math.round((props.data.tokens / props.data.threshold) * 100));

  return (
    <div class="flex-1">
      <div class="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{props.label}</span>
        <span class="tabular-nums">{percentage()}%</span>
      </div>
      <div class="relative h-4 overflow-hidden rounded bg-muted/50">
        <div
          class={cn("h-full rounded transition-all duration-300", barColor(percentage()))}
          data-slot="bar-fill"
          style={{ width: `${percentage()}%` }}
        />
        <span class="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-foreground/70">
          {formatTokens(props.data.tokens)} / {formatTokens(props.data.threshold)}
        </span>
      </div>
    </div>
  );
}

export function OmProgressBars(props: { messages: WindowData; observations: WindowData }) {
  return (
    <div class="flex gap-3" data-component="om-progress-bars">
      <ProgressBar data={props.messages} label="Messages" />
      <ProgressBar data={props.observations} label="Observations" />
    </div>
  );
}
