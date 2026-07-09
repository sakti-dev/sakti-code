import { createEffect, For, on, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import type { ContextMenuMode, Row } from "./context-rows";

export interface InlineContextListProps {
  activeId: string | null;
  mode: ContextMenuMode;
  onPick: (token: string) => void;
  rows: Row[];
}

/**
 * Inline banner list shown above the chat input when `/` or `@` is active.
 * Presentational: the parent owns the rows (via buildRows) and keyboard nav
 * (via useListNavigation); this component only renders rows, tracks the active
 * one for aria + scroll, and picks on click. Rows render in the order given so
 * arrow order matches visual order. A group heading is emitted whenever the
 * row's group changes.
 */
export function InlineContextList(props: InlineContextListProps): JSX.Element {
  let listRef: HTMLDivElement | undefined;

  const scrollActive = () => {
    const list = listRef;
    if (!list) {
      return;
    }
    const el = list.querySelector('[data-active="true"]');
    if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  };

  createEffect(
    on(
      () => props.activeId,
      () => scrollActive(),
    ),
  );

  return (
    <div
      aria-live="polite"
      class="-mb-2 max-h-[25rem] overflow-y-auto overflow-x-hidden rounded-t-xl border-primary/30 border-x border-t bg-popover/95 backdrop-blur"
      ref={(el) => {
        listRef = el;
      }}
      role="listbox"
    >
      <Show
        fallback={<div class="px-3 py-2 text-muted-foreground text-xs">No matches</div>}
        when={props.rows.length > 0}
      >
        <For each={props.rows}>
          {(row, i) => (
            <>
              <Show when={i() === 0 || props.rows[i() - 1]?.group !== row.group}>
                <p class="px-3 pt-2 font-medium text-muted-foreground text-xs">{row.group}</p>
              </Show>
              <button
                aria-selected={props.activeId === row.id ? "true" : "false"}
                class={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  props.activeId === row.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                data-active={props.activeId === row.id ? "true" : "false"}
                data-token={row.token}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onPick(row.token)}
                role="option"
                type="button"
              >
                <span class="truncate font-medium">{row.label}</span>
                <Show when={row.description}>
                  <span class="truncate text-muted-foreground text-xs">{row.description}</span>
                </Show>
              </button>
            </>
          )}
        </For>
      </Show>
    </div>
  );
}
