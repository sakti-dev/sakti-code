import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { FiCheck, FiMoreVertical, FiTrash2, FiX } from "solid-icons/fi";
import { createSignal, onCleanup, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import type { SessionMeta } from "~/stores/server/server-store";

dayjs.extend(relativeTime);

export type MissionStatus = SessionMeta["status"];
export type StreamPhase = "idle" | "thinking" | "writing" | "tool_running" | "error";

const STATUS_CLASS: Record<MissionStatus, string> = {
  planning: "bg-muted text-muted-foreground",
  building: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  review: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  merged: "bg-green-500/10 text-green-600 dark:text-green-400",
};

const STATUS_LABEL: Record<MissionStatus, string> = {
  planning: "planning",
  building: "building",
  review: "review",
  merged: "merged",
};

function dotClass(phase: StreamPhase): string {
  switch (phase) {
    case "thinking":
    case "writing":
    case "tool_running":
      return "bg-blue-500 animate-pulse";
    case "error":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/40";
  }
}

export interface MissionRowProps {
  isActive: boolean;
  status: MissionStatus;
  streamPhase: StreamPhase;
  title: string | null;
  updatedAt: number;
  onClick: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
}

export function MissionRow(props: MissionRowProps): JSX.Element {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const beginRename = () => {
    setDraft(props.title ?? "");
    setEditing(true);
  };

  const commitRename = () => {
    const next = draft().trim();
    if (next && next !== props.title) {
      props.onRename?.(next);
    }
    setEditing(false);
  };

  const cancelRename = () => setEditing(false);

  // Outside-click closes the kebab dropdown (only active while it's open).
  const onDocClick = (e: MouseEvent) => {
    if (!menuOpen()) return;
    const target = e.target as HTMLElement | null;
    if (target && !target.closest(`[data-component="mission-row"]`)) {
      setMenuOpen(false);
    }
  };
  document.addEventListener("click", onDocClick);
  onCleanup(() => document.removeEventListener("click", onDocClick));

  return (
    <div
      class={cn(
        "group relative border-l-2 px-3 py-1.5 transition-colors",
        props.isActive
          ? "border-l-primary bg-secondary"
          : "border-l-transparent hover:bg-secondary/50",
      )}
      data-component="mission-row"
      data-status={props.status}
    >
      <Show
        when={!editing()}
        fallback={
          <div class="flex items-center gap-1 py-0.5">
            <input
              autofocus
              class="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs"
              onChange={(e) => setDraft(e.currentTarget.value)}
              onFocusOut={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              type="text"
              value={draft()}
            />
            <button
              class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={commitRename}
              title="Save"
              type="button"
            >
              <FiCheck class="h-3 w-3" />
            </button>
            <button
              class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={cancelRename}
              title="Cancel"
              type="button"
            >
              <FiX class="h-3 w-3" />
            </button>
          </div>
        }
      >
        <button
          class="flex w-full flex-col gap-0.5 text-left"
          onClick={props.onClick}
          type="button"
        >
          <span class="flex items-center justify-between gap-2">
            <span class="min-w-0 flex-1 truncate text-xs text-foreground">
              {props.title || "Untitled mission"}
            </span>
            <span class="shrink-0 text-[10px] text-muted-foreground/70">
              {dayjs(props.updatedAt).fromNow()}
            </span>
          </span>
          <span class="flex items-center gap-1.5">
            <span class={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(props.streamPhase))} />
            <span
              class={cn(
                "rounded px-1.5 py-px text-[10px] font-medium capitalize",
                STATUS_CLASS[props.status],
              )}
            >
              {STATUS_LABEL[props.status]}
            </span>
          </span>
        </button>
      </Show>

      {/* Kebab — always visible (dim at rest, brighten on hover/active). */}
      <Show when={!editing()}>
        <div class="absolute right-1 top-1.5 opacity-40 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            type="button"
          >
            <FiMoreVertical class="h-3.5 w-3.5" />
          </button>
          <Show when={menuOpen()}>
            <div
              class="absolute right-0 top-6 z-50 min-w-28 rounded-md border border-border bg-popover py-0.5 shadow-md"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                class="block w-full px-3 py-1 text-left text-xs text-foreground hover:bg-secondary"
                onClick={() => {
                  setMenuOpen(false);
                  beginRename();
                }}
                type="button"
              >
                Rename
              </button>
              <button
                class="block w-full px-3 py-1 text-left text-xs text-red-600 hover:bg-secondary"
                onClick={() => {
                  setMenuOpen(false);
                  props.onDelete?.();
                }}
                type="button"
              >
                <span class="inline-flex items-center gap-1.5">
                  <FiTrash2 class="h-3 w-3" />
                  Delete
                </span>
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
