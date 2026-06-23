import { Show } from "solid-js";

interface EmptyStateProps {
  icon?: string;
  subtitle?: string;
  title: string;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="flex flex-col items-center justify-center rounded-xl border border-border border-dashed p-8 text-center">
      <Show when={props.icon}>
        <span class="mb-3 text-4xl opacity-50">{props.icon}</span>
      </Show>
      <h3 class="font-medium text-foreground text-sm">{props.title}</h3>
      <Show when={props.subtitle}>
        <p class="mt-1 text-muted-foreground text-xs">{props.subtitle}</p>
      </Show>
    </div>
  );
}
