import { For, Show } from "solid-js";
import { cn } from "~/lib/utils/index.ts";

interface ObservationItem {
  priority?: "P1" | "P2" | "P3";
  text: string;
}

const PRIORITY_STYLES: Record<"P1" | "P2" | "P3", string> = {
  P1: "border-l-destructive bg-destructive/5",
  P2: "border-l-warning bg-warning/5",
  P3: "border-l-success bg-success/5",
};

function parseObservations(text: string): ObservationItem[] {
  const cleaned = text
    .replace(/<\/?observations>/g, "")
    .replace(/<\/?current-task>/g, "")
    .replace(/<\/?suggested-response>/g, "")
    .trim();
  if (!cleaned) return [];

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const items: ObservationItem[] = [];

  for (const line of lines) {
    const match = line.match(/^[🔴🟡🟢⚫⚪]+\s*(P[123])?\s*:?\s*(.+)$/u);
    if (match) {
      const priority = match[1] as "P1" | "P2" | "P3" | undefined;
      const itemText = match[2] || line;
      items.push({ priority, text: itemText });
    } else if (line.startsWith("-") || line.startsWith("*")) {
      items.push({ text: line.replace(/^[-*]\s*/, "") });
    } else {
      items.push({ text: line });
    }
  }

  return items;
}

export function ObservationRenderer(props: { text: string }) {
  const items = () => parseObservations(props.text);

  return (
    <div class="flex flex-col gap-1" data-component="observation-renderer">
      <For each={items()}>
        {(item) => (
          <div
            class={cn(
              "rounded-r-md border-l-2 px-3 py-1.5 text-xs",
              item.priority ? PRIORITY_STYLES[item.priority] : "border-l-border bg-muted/30",
            )}
            data-priority={item.priority ?? undefined}
          >
            <Show when={item.priority}>
              <span class="mr-1 font-medium">{item.priority}</span>
            </Show>
            {item.text}
          </div>
        )}
      </For>
    </div>
  );
}
